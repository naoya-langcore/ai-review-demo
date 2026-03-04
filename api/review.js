export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });

  try {
    const { applicationData, ocrData, checkItems } = req.body;

    const prompt = `あなたは補助金・助成金申請の審査AIです。以下の申請情報とOCR読取結果を照合し、審査を行ってください。

## 審査チェック項目
${checkItems.map((c, i) => `${i + 1}. ${c}`).join('\n')}

## 申請情報
${JSON.stringify(applicationData, null, 2)}

## OCR読取結果（書類から読み取った情報）
${JSON.stringify(ocrData, null, 2)}

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
  ],
  "matchResults": {
    "juuminhyo": "一致" または "不一致" または "一致（※注意事項）",
    "studentId": "一致" または "不一致",
    "bankDoc": "一致" または "不一致" または "一致（※注意事項）"
  }
}`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 2048,
            responseMimeType: "application/json"
          }
        })
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return res.status(500).json({ error: 'Gemini API error', detail: errText });
    }

    const geminiData = await geminiRes.json();
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) return res.status(500).json({ error: 'Empty response from Gemini' });

    // Parse JSON from response
    let result;
    try {
      const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      result = JSON.parse(cleaned);
    } catch (e) {
      return res.status(500).json({ error: 'Failed to parse Gemini response', raw: text });
    }

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: 'Server error', message: err.message });
  }
}
