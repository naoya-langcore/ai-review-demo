async function callOpenAI(apiKey, prompt) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 2048,
      response_format: { type: 'json_object' }
    })
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API error: ${errText}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Empty response from OpenAI');
  return JSON.parse(text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  try {
    const { applicationData } = req.body;

    const prompt = `あなたは私立中学校授業料支援助成金の審査AIです。以下の申請データを審査してください。

## 審査チェック項目（すべて確認すること）
1. 学年整合性：学年・入学年月が生年月日と矛盾しないか（例：中1なら入学年に12〜13歳であるべき）
2. 姓の一致：生徒の姓と申請者の姓が異なる場合は要確認（再婚等の可能性はあるがフラグを立てる）
3. 続柄確認：続柄が「父」または「母」になっているか（祖父母等は要確認）
4. 口座名義：口座名義カナが「申請者姓カナ＋スペース＋申請者名カナ」と一致するか
5. 在籍確認：在籍確認が「在籍中」であるか（「退学済み」「休学中」「確認不可」等はerrorとする）
6. 授業料妥当性：年間授業料が極端に低い（10万円未満）または高い（200万円超）でないか
7. 助成額上限チェック：この制度の助成額の上限は10万円（100,000円）と定められている。助成額が100,000円を超えている場合はerrorとする。※授業料との比較ではなく、制度上の上限額との比較であることに注意
8. 助成額と授業料の比較：助成額が年間授業料を超えている場合はerrorとする

## 申請データ
${JSON.stringify(applicationData, null, 2)}

## 回答形式
以下のJSON形式で回答してください。JSON以外は出力しないでください。

{
  "overall": "OK" または "要確認",
  "score": 0〜100の整数,
  "summary": "総合コメント（日本語で2-3文）",
  "findings": [
    {
      "severity": "error" または "warning" または "info",
      "category": "カテゴリ名",
      "message": "詳細メッセージ（日本語）",
      "field": "該当フィールド名 または null"
    }
  ]
}`;

    const result = await callOpenAI(apiKey, prompt);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: 'Server error', message: err.message });
  }
}
