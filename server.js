const http = require('http');
const fs = require('fs');
const path = require('path');

// .env ファイルから環境変数を読み込み
try {
  const envPath = path.join(__dirname, '.env');
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...vals] = trimmed.split('=');
      process.env[key.trim()] = vals.join('=').trim();
    }
  });
} catch (e) { /* .env がなくても起動は可能 */ }

const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

// OpenAI API 共通呼び出し
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

// OpenAI チャット呼び出し（テキスト応答）
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

// CORS ヘッダ設定
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// 単体審査: POST /api/review
async function handleReview(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { res.writeHead(500); res.end(JSON.stringify({ error: 'OPENAI_API_KEY not configured. Create a .env file with OPENAI_API_KEY=your_key' })); return; }

  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { applicationData } = JSON.parse(body);

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
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Server error', message: err.message }));
  }
}

// 横断審査: POST /api/review-school
async function handleReviewSchool(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { res.writeHead(500); res.end(JSON.stringify({ error: 'OPENAI_API_KEY not configured' })); return; }

  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { schoolName, applications } = JSON.parse(body);

    const prompt = `あなたは私立中学校授業料支援助成金の審査AIです。同一学校「${schoolName}」の申請データ${applications.length}件を横断的にチェックしてください。

## 横断チェック項目

### 1. 重複申請（type: "duplicate"）
全申請の「生徒姓＋生徒名＋生年月日」を1件ずつ総当たりで比較し、完全一致するペアがあれば重複として検出する。
- 申請者（父・母）が異なっていても、生徒情報が同一であれば重複とみなす
- 例：受付番号Aと受付番号Bで生徒姓・生徒名・生年月日が全て一致 → duplicate（ids: [A, B]）

### 2. 在籍確認（type: "enrollment_issue"）
在籍確認が「在籍中」でない申請を検出する。

### 3. 授業料外れ値（type: "tuition_outlier"）
同一学校内の年間授業料の中央値を求め、中央値の±70%を超える申請はerror、±30%を超える申請はwarningとする。

### 4. 助成額の制度上限超過（type: "subsidy_over_cap"）
各申請の助成額と固定値100,000円を比較する（授業料は関係しない）。
- 助成額 > 100,000 → 検出。message例：「助成額（X円）が制度上限額（100,000円）を超えています」

### 5. 助成額の授業料超過（type: "subsidy_over_tuition"）
各申請の助成額と年間授業料を比較する（制度上限は関係しない）。
- 助成額 > 年間授業料 → 検出。message例：「助成額（X円）が年間授業料（Y円）を超えています」
- 助成額 ≤ 年間授業料 → 問題なし、絶対に検出しない

## ルール
- 全5項目を必ずチェックすること
- messageには必ず具体的な数値や受付番号を含めること
- 問題がなければissuesは空配列にすること

## 申請データ一覧
${JSON.stringify(applications, null, 2)}

## 回答形式（JSON以外は出力しないでください）
{
  "issues": [
    {
      "type": "enrollment_issue" または "tuition_outlier" または "subsidy_over_cap" または "subsidy_over_tuition" または "duplicate",
      "title": "問題のタイトル（日本語）",
      "message": "具体的な数値や受付番号を含む詳細説明（日本語）",
      "ids": ["該当する受付番号の配列"]
    }
  ]
}`;

    const result = await callOpenAI(apiKey, prompt);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Server error', message: err.message }));
  }
}

// チャット: POST /api/chat
async function handleChat(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { res.writeHead(500); res.end(JSON.stringify({ error: 'OPENAI_API_KEY not configured' })); return; }

  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { messages, applications } = JSON.parse(body);

    const dataSummary = applications.map(a =>
      `${a.受付番号}: ${a.学校名||''} ${a.生徒姓}${a.生徒名} ${a.学年}年 授業料${a.年間授業料}円 助成額${a.助成額}円 在籍:${a.在籍確認}`
    ).join('\n');

    const systemMsg = `あなたは私立中学校授業料支援助成金の審査を支援するAIアシスタントです。
ユーザーと対話しながら、審査の評価観点を一緒に検討します。

## 対象データ概要（${applications.length}件）
${dataSummary}

## あなたの役割
- ユーザーが指定した観点を整理し、具体的な審査基準に落とし込む
- データの特徴を踏まえて追加の観点を提案する
- 曖昧な指示があれば質問して明確にする
- 簡潔に応答する（長くなりすぎない）

まだ審査は実行しないでください。観点の整理と議論のみ行ってください。`;

    const apiMessages = [
      { role: 'system', content: systemMsg },
      ...messages
    ];

    const reply = await callOpenAIChat(apiKey, apiMessages);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ reply }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Server error', message: err.message }));
  }
}

// 会話を踏まえた審査: POST /api/review-with-context
async function handleReviewWithContext(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { res.writeHead(500); res.end(JSON.stringify({ error: 'OPENAI_API_KEY not configured' })); return; }

  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { conversation, applications } = JSON.parse(body);

    // 会話履歴からコンテキストを構成
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
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Server error', message: err.message }));
  }
}

const server = http.createServer((req, res) => {
  if (req.url === '/api/review') { handleReview(req, res); return; }
  if (req.url === '/api/review-school') { handleReviewSchool(req, res); return; }
  if (req.url === '/api/chat') { handleChat(req, res); return; }
  if (req.url === '/api/review-with-context') { handleReviewWithContext(req, res); return; }

  // Static files
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, filePath);
  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'text/plain';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
    } else {
      res.writeHead(200, { 'Content-Type': contentType + '; charset=utf-8' });
      res.end(data);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  if (!process.env.OPENAI_API_KEY) {
    console.log('WARNING: OPENAI_API_KEY is not set. Create a .env file with OPENAI_API_KEY=your_key');
  } else {
    console.log('OpenAI API key loaded.');
  }
});
