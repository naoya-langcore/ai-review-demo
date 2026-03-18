async function callOpenAIChat(apiKey, messages) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.4,
      max_tokens: 2048
    })
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API error: ${errText}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
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
    const { messages, applications } = req.body;

    const dataSummary = applications.map(a =>
      `${a.受付番号}: ${a.学校名||''} ${a.生徒姓}${a.生徒名} ${a.学年}年 授業料${a.年間授業料}円 助成額${a.助成額}円 在籍:${a.在籍確認}`
    ).join('\n');

    const schoolCounts = {};
    applications.forEach(a => { schoolCounts[a.学校名] = (schoolCounts[a.学校名]||0) + 1; });
    const schoolSummary = Object.entries(schoolCounts).map(([s,c]) => `  ・${s}（${c}件）`).join('\n');

    const systemMsg = `あなたは私立中学校授業料支援助成金の審査を支援するAIアシスタントです。
ユーザーと対話しながら、審査の範囲（スコープ）と評価観点を一緒に検討します。

## 全データ概要（${applications.length}件）
学校別内訳：
${schoolSummary}

各申請データ：
${dataSummary}

## あなたの役割
1. まずユーザーと「何を審査したいか」を会話で明確にする
   - 審査の範囲：全件横断、特定の学校単位、特定条件の申請など
   - 審査の観点：重複チェック、金額妥当性、不自然なパターンなど
2. ユーザーの意図を整理し、具体的な審査基準に落とし込む
3. データの特徴を踏まえて追加の観点を提案する
4. 曖昧な指示があれば質問して明確にする
5. 簡潔に応答する（長くなりすぎない）

まだ審査は実行しないでください。範囲と観点の整理・議論のみ行ってください。`;

    const apiMessages = [
      { role: 'system', content: systemMsg },
      ...messages
    ];

    const reply = await callOpenAIChat(apiKey, apiMessages);
    return res.status(200).json({ reply });
  } catch (err) {
    return res.status(500).json({ error: 'Server error', message: err.message });
  }
}
