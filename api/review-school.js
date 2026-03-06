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

### 1. 在籍確認（type: "enrollment_issue"）
在籍確認が「在籍中」でない申請を検出する。

### 2. 授業料外れ値（type: "tuition_outlier"）
同一学校内の年間授業料の中央値を求め、中央値の±70%を超える申請はerror、±30%を超える申請はwarningとする。

### 3. 助成額の制度上限超過（type: "subsidy_over_cap"）
【判定対象】各申請の助成額と固定値100,000円の比較（授業料は関係しない）
- 助成額 > 100,000 → 検出する。messageに「助成額（X円）が制度上限額（100,000円）を超えています」と記載
- 助成額 ≤ 100,000 → 問題なし

### 4. 助成額の授業料超過（type: "subsidy_over_tuition"）
【判定対象】各申請の助成額と年間授業料の比較（制度上限は関係しない）
- 助成額 > 年間授業料 → 検出する。messageに「助成額（X円）が年間授業料（Y円）を超えています」と記載
- 助成額 ≤ 年間授業料 → 問題なし、絶対に検出しない

### 5. 重複申請（type: "duplicate"）
生徒姓＋生徒名＋生年月日が完全一致する申請が2件以上ある場合、重複として検出する。申請者（父・母）が異なっていても同一生徒であれば重複とみなす。全申請の生徒姓・生徒名・生年月日を1件ずつ比較して確認すること。

## ルール
- messageには必ず具体的な数値や受付番号を含めること
- 問題がなければissuesは空配列にすること

## 申請データ一覧
${JSON.stringify(applications, null, 2)}

## 回答形式（JSON以外は出力しないでください）
{
  "issues": [
    {
      "type": "enrollment_issue" | "tuition_outlier" | "subsidy_over_cap" | "subsidy_over_tuition" | "duplicate",
      "title": "問題のタイトル（日本語）",
      "message": "具体的な数値や受付番号を含む詳細説明（日本語）",
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
