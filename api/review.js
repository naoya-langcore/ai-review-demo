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

    const prompt = `あなたは私立中学校授業料支援助成金の審査AIです。以下の申請データを、定められた全チェック項目について審査してください。

## 審査の進め方
各チェック項目について、まず申請データから該当する数値・文字列を抜き出し、条件と照合してから判定すること。
**全項目について必ず結果を返すこと。問題がない項目もresult="ok"で含めること。**

## 審査チェック項目

### 1. 学年整合性（id: "grade_consistency"）
入学年月時点の年齢を生年月日から計算し、学年と矛盾がないか確認する。
- 中1→入学時12〜13歳、中2→13〜14歳、中3→14〜15歳
- 矛盾がある場合: result="error"
- 問題なし: result="ok"

### 2. 姓の一致（id: "name_match"）
生徒の姓と申請者の姓が異なる場合: result="warning"（再婚等の可能性あり）
一致する場合: result="ok"

### 3. 続柄確認（id: "relationship"）
続柄が「父」「母」以外の場合: result="warning"
「父」「母」の場合: result="ok"

### 4. 口座名義確認（id: "account_holder"）
口座名義カナが「申請者姓カナ＋全角スペース＋申請者名カナ」と一致しない場合: result="warning"
一致する場合: result="ok"

### 5. 在籍確認（id: "enrollment"）
在籍確認が「在籍中」でない場合: result="error"
「在籍中」の場合: result="ok"

### 6. 授業料妥当性（id: "tuition_range"）
年間授業料が10万円未満または200万円超の場合: result="warning"
範囲内の場合: result="ok"

### 7. 助成額の制度上限チェック（id: "subsidy_cap"）
助成額 > 100,000 → result="error"
助成額 ≤ 100,000 → result="ok"

### 8. 助成額対授業料チェック（id: "subsidy_vs_tuition"）
助成額 > 年間授業料 → result="error"
助成額 ≤ 年間授業料 → result="ok"

### 9. 提出書類の原本照合（id: "ocr_verification"）
※この項目はOCR読取結果と申請データの照合を行う項目です。
本デモでは照合対象の書類画像がないため、result="skip"（実行スキップ）としてください。

## ルール
- **全9項目について必ずchecksに含めること（okの項目も必須）**
- idは各項目で指定した値を正確に使用すること
- messageには必ず具体的な数値を含めること（ok/skipの場合は確認した内容を簡潔に記載）

## 申請データ
${JSON.stringify(applicationData, null, 2)}

## 回答形式（JSON以外は出力しないでください）
{
  "overall": "OK" または "要確認",
  "score": 0〜100の整数,
  "summary": "総合コメント（日本語で2-3文）",
  "checks": [
    {
      "id": "項目ID",
      "result": "ok" / "warning" / "error" / "skip",
      "message": "判定理由・確認した内容（日本語、具体的な数値を含む）"
    }
  ]
}`;

    const result = await callOpenAI(apiKey, prompt);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: 'Server error', message: err.message });
  }
}
