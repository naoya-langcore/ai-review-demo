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

## 審査の進め方
各チェック項目について、まず申請データから該当する数値・文字列を抜き出し、条件と照合してから判定すること。

## 審査チェック項目

### 1. 学年整合性（category: "学年整合性"）
入学年月時点の年齢を生年月日から計算し、学年と矛盾がないか確認する。
- 中1→入学時12〜13歳、中2→13〜14歳、中3→14〜15歳
- 矛盾がある場合: severity=error

### 2. 姓の一致（category: "姓の一致"）
生徒の姓と申請者の姓が異なる場合: severity=warning（再婚等の可能性あり）

### 3. 続柄確認（category: "続柄確認"）
続柄が「父」「母」以外の場合: severity=warning

### 4. 口座名義確認（category: "口座名義"）
口座名義カナが「申請者姓カナ＋全角スペース＋申請者名カナ」と一致しない場合: severity=warning

### 5. 在籍確認（category: "在籍確認"）
在籍確認が「在籍中」でない場合: severity=error

### 6. 授業料妥当性（category: "授業料妥当性"）
年間授業料が10万円未満または200万円超の場合: severity=warning

### 7. 助成額の制度上限チェック（category: "助成額上限超過"）
【判定対象】助成額と固定値100,000円の比較（授業料は関係しない）
- 手順: 助成額の値を読み取る → 100,000と比較する
- 助成額 > 100,000 → severity=error, message=「助成額（X円）が制度上限額（100,000円）を超えています」
- 助成額 ≤ 100,000 → 問題なし、findingsに含めない
- 例: 助成額120,000 > 100,000 → error「助成額（120,000円）が制度上限額（100,000円）を超えています」
- 例: 助成額100,000 ≤ 100,000 → 問題なし

### 8. 助成額が授業料を超過していないか（category: "助成額対授業料超過"）
【判定対象】助成額と年間授業料の比較（制度上限は関係しない）
- 手順: 助成額の値と年間授業料の値を読み取る → 両者を比較する
- 助成額 > 年間授業料 → severity=error, message=「助成額（X円）が年間授業料（Y円）を超えています」
- 助成額 ≤ 年間授業料 → 問題なし、findingsに絶対に含めない
- 例: 助成額100,000 vs 授業料35,000 → 100,000 > 35,000 → error
- 例: 助成額120,000 vs 授業料480,000 → 120,000 < 480,000 → 問題なし（findingsに含めない）

## ルール
- findingsには問題がある項目のみを含めること。問題のない項目は出力しないこと
- categoryは各項目で指定した値を正確に使用すること
- messageには必ず具体的な数値を含めること

## 申請データ
${JSON.stringify(applicationData, null, 2)}

## 回答形式（JSON以外は出力しないでください）
{
  "overall": "OK" または "要確認",
  "score": 0〜100の整数,
  "summary": "総合コメント（日本語で2-3文）",
  "findings": [
    {
      "severity": "error" または "warning",
      "category": "上記で指定したcategory値",
      "message": "具体的な数値を含む詳細メッセージ（日本語）",
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
