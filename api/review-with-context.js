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
    const { conversation, applications } = req.body;

    const convText = conversation.map(m => `${m.role === 'user' ? 'ユーザー' : 'AI'}: ${m.content}`).join('\n');

    const prompt = `あなたは私立中学校授業料支援助成金の審査AIです。
ユーザーとの事前の対話で決定された評価観点に基づいて、以下の申請データを横断的に審査してください。

## 事前の対話内容
${convText}

## 指示
上記の対話で議論された評価観点・基準を抽出し、それに基づいて全申請データを審査してください。
対話で明示的に言及された観点を最優先しつつ、基本的なチェック（重複、在籍確認、金額妥当性）も行ってください。

## 申請データ一覧
${JSON.stringify(applications, null, 2)}

## 回答形式（JSON以外は出力しないでください）
{
  "appliedCriteria": ["実際に適用した評価観点のリスト"],
  "issues": [
    {
      "type": "対話で決まったカテゴリ名 or duplicate/enrollment_issue/tuition_outlier/subsidy_over_cap/subsidy_over_tuition/custom",
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
