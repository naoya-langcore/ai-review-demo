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
    const { schoolName, applications } = req.body;

    const prompt = `あなたは私立中学校授業料支援助成金の審査AIです。同一学校「${schoolName}」の申請データ${applications.length}件を横断的にチェックしてください。

## 横断チェック項目
1. 在籍確認：在籍確認が「在籍中」でない申請がある場合、問題として検出する（type: "enrollment_issue"）
2. 授業料外れ値：同一学校内の年間授業料の中央値を求め、中央値の±70%を超える申請はerror、±30%を超える申請はwarningとする（type: "tuition_outlier"）
3. 助成額超過：助成額が制度上の上限額（10万円）を超えている、または助成額が年間授業料を超えている申請を検出する（type: "subsidy_excess"）
4. 重複申請：生徒の姓名＋生年月日が完全一致する申請が複数ある場合、重複として検出する（type: "duplicate"）

## 申請データ一覧
${JSON.stringify(applications, null, 2)}

## 回答形式
以下のJSON形式で回答してください。JSON以外は出力しないでください。
問題がなければ issues は空配列にしてください。

{
  "issues": [
    {
      "type": "enrollment_issue" または "tuition_outlier" または "subsidy_excess" または "duplicate",
      "title": "問題のタイトル（日本語）",
      "message": "詳細な説明（日本語、具体的な数値や受付番号を含めること）",
      "ids": ["該当する受付番号の配列"]
    }
  ]
}`;

    const result = await callOpenAI(apiKey, prompt);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: 'Server error', message: err.message });
  }
}
