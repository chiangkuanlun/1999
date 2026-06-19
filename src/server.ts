import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';
import { GoogleGenAI, Type } from '@google/genai';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

// Parse JSON request bodies
app.use(express.json());

// Initialize Gemini Client
const geminiApiKey = process.env['GEMINI_API_KEY'];
let ai: GoogleGenAI | null = null;
if (geminiApiKey) {
  ai = new GoogleGenAI({
    apiKey: geminiApiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Interfaces
interface Department {
  id: string;
  name: string;
  category: string;
  responsibilities: string[];
  contact: string;
}

interface CaseLog {
  timestamp: string;
  action: string;
  operator: string;
  details: string;
}

interface Case {
  id: string;
  title: string;
  description: string;
  category: string;
  departmentId: string;
  status: '待處理' | '處理中' | '已結案';
  createdAt: string;
  dispatchedAt: string;
  confidence: number;
  dispatchReason: string;
  feedback?: string;
  logs: CaseLog[];
  citizenName?: string;
  citizenPhone?: string;
  location?: string;
  urgency?: '一般' | '緊急' | '特急';
  isManuallyRerouted?: boolean;
}

// In-Memory Database Seed Data
const departments: Department[] = [
  {
    id: 'dp_public_works_road',
    name: '工務局養護工程處 (養工處)',
    category: '道路與公用設施',
    responsibilities: ['路面坑洞修補', '人行道損壞', '路燈故障或不亮', '水溝不通堵塞', '路樹剪修傾倒'],
    contact: '02-27208889 #555'
  },
  {
    id: 'dp_env_noise',
    name: '環境保護局噪音公害管制科',
    category: '環保與公害檢舉',
    responsibilities: ['營建工地噪音', '營業娛樂場所噪音', '深夜擴音喇叭干擾', '工廠噪音公害'],
    contact: '02-27208889 #333'
  },
  {
    id: 'dp_env_cleaning',
    name: '環境保護局清潔維護科',
    category: '環境衛生與垃圾',
    responsibilities: ['路面積水及大型垃圾', '違規小廣告小傳單', '大型家具廢棄物清運', '動物死體清理', '環境公衛髒亂'],
    contact: '02-27208889 #334'
  },
  {
    id: 'dp_police_traffic',
    name: '警察局交通警察大隊',
    category: '交通違規與治安',
    responsibilities: ['道路並排停車與違規停車', '障礙佔用車道人行道', '交通號誌故障報修', '車禍事故及道路阻塞'],
    contact: '110'
  },
  {
    id: 'dp_health_food',
    name: '衛生局食品藥物管理科',
    category: '食品安全與公共衛生',
    responsibilities: ['餐飲場所廚房髒亂老鼠', '買賣過期食品不良品', '疑似群體食物中毒事件', '食品標示廣告不實', '公共場所室內違法吸煙'],
    contact: '02-27208889 #222'
  },
  {
    id: 'dp_social_welfare',
    name: '社會局社會救助科',
    category: '社會救助與福利',
    responsibilities: ['無家者/浪人低溫炎熱關懷安置', '急難救助金申辦', '長者獨居探視與緊急通知', '弱勢及高風險家庭通報'],
    contact: '02-27208889 #111'
  }
];

const cases: Case[] = [
  {
    id: 'case_001',
    title: '民生路二段路燈整排不亮',
    description: '已經不亮三天了，每到晚上視線非常黑暗，行人走在路上十分危險，容易發生搶劫或車禍，請工務局儘速修復謝謝。',
    category: '道路與公用設施',
    departmentId: 'dp_public_works_road',
    status: '已結案',
    createdAt: '2026-06-15T10:24:00.000Z',
    dispatchedAt: '2026-06-15T10:25:00.000Z',
    confidence: 0.98,
    dispatchReason: 'AI 自動定位研判：內文提及「路燈整排不亮」、「工務局修復」，與工務局養護工程處核心職責「路燈故障或不亮」、「公用設施維護」高度契合。',
    feedback: '養工處已於 6/16 下午 15:30 派遣路燈工班前往，更換變壓器與損壞之 LED 燈泡 4 盞，目前路段皆已恢復照明。',
    citizenName: '陳大民',
    citizenPhone: '0912-345-678',
    location: '台北市中山區民生路二段 45 號附近',
    urgency: '緊急',
    isManuallyRerouted: false,
    logs: [
      { timestamp: '2026-06-15T10:24:00.000Z', action: '案件登錄', operator: '市民陳大民', details: '民眾線上陳情案件建立。' },
      { timestamp: '2026-06-15T10:25:00.000Z', action: '智能分派', operator: 'AI自動派遣引擎', details: '自適應分派至【工務局養護工程處 (養工處)】，置信度：98%' },
      { timestamp: '2026-06-15T13:00:00.000Z', action: '狀態更新', operator: '工務局承辦人', details: '案件受理，已排定工班行程。' },
      { timestamp: '2026-06-16T15:30:00.000Z', action: '案件結案', operator: '工務局承辦人', details: '工班修復完成，結案回覆客戶。' }
    ]
  },
  {
    id: 'case_002',
    title: '大安路一段 101 號對面有並排停車',
    description: '一台黑色轎車大剌剌並排停在機車道上，導致所有機車必須切到外側快車道，非常危險，希望警察能來開罰單與拖吊。',
    category: '交通違規與治安',
    departmentId: 'dp_police_traffic',
    status: '已結案',
    createdAt: '2026-06-16T08:30:00.000Z',
    dispatchedAt: '2026-06-16T08:31:00.000Z',
    confidence: 0.96,
    dispatchReason: 'AI 自動定位研判：偵測到關鍵詞「並排停車」、「機車道」、「警察開罰單」，與警察局交通警察大隊之「道路並排停車與違規停車」主要職權高度契合。',
    feedback: '轄區派出所已於接獲派工後 15 分鐘內，指派巡邏警員前往取締。現場該車已駛離，後續會調閱監視器針對並排停車違規事實列入系統逕行舉發。',
    citizenName: '李小姐',
    citizenPhone: '0922-111-222',
    location: '台北市大安區大安路一段 101 號',
    urgency: '一般',
    isManuallyRerouted: false,
    logs: [
      { timestamp: '2026-06-16T08:30:00.000Z', action: '案件登錄', operator: '市民李小姐', details: '民眾線上陳情案件建立。' },
      { timestamp: '2026-06-16T08:31:00.000Z', action: '智能分派', operator: 'AI自動派遣引擎', details: '自適應分派至【警察局交通警察大隊】，置信度：96%' },
      { timestamp: '2026-06-16T08:45:00.000Z', action: '案件結案', operator: '交通大隊派駐員', details: '警員前往取締完成，予以結案。' }
    ]
  },
  {
    id: 'case_003',
    title: '住家隔壁深夜卡拉OK噪音震耳欲聾',
    description: '每天晚上11點了還唱很大聲，重低音震動聲嚴重影響睡眠，讓人快精神衰弱。地點在和平東路三段五樓。',
    category: '環保與公害檢舉',
    departmentId: 'dp_env_noise',
    status: '處理中',
    createdAt: '2026-06-16T23:45:00.000Z',
    dispatchedAt: '2026-06-16T23:46:00.000Z',
    confidence: 0.94,
    dispatchReason: 'AI 自動定位研判：提及「深夜卡拉OK」、「噪音」、「影響睡眠」，對應環境保護局噪音公害管制科之「深夜擴音喇叭干擾」或「營業娛樂場所噪音」業務範疇。',
    citizenName: '張先生',
    citizenPhone: '0955-444-333',
    location: '台北市信義區和平東路三段 120 號五樓',
    urgency: '緊急',
    isManuallyRerouted: false,
    logs: [
      { timestamp: '2026-06-16T23:45:00.000Z', action: '案件登錄', operator: '市民張先生', details: '民眾線上陳情案件建立。' },
      { timestamp: '2026-06-16T23:46:00.000Z', action: '智能分派', operator: 'AI自動派遣引擎', details: '自適應分派至【環境保護局噪音公害管制科】，置信度：94%' },
      { timestamp: '2026-06-17T00:30:00.000Z', action: '狀態更新', operator: '環保局稽查員', details: '已立案受理，排定夜間稽查工單。' }
    ]
  },
  {
    id: 'case_004',
    title: '某熱門便當店廚房地板有老鼠跑動',
    description: '在松山路某連鎖便當店點餐時，不小心看到廚房後門打開，地板髒亂不堪，排水溝蓋旁邊甚至有老鼠爬來爬去，這食品安全太扯了吧，希望趕快派人督導。',
    category: '食品安全與公共衛生',
    departmentId: 'dp_health_food',
    status: '待處理',
    createdAt: '2026-06-17T01:15:00.000Z',
    dispatchedAt: '2026-06-17T01:17:00.000Z',
    confidence: 0.97,
    dispatchReason: 'AI 自動定位研判：識別關鍵要素「便當店廚房」、「食品安全」、「老鼠髒亂」，精確判定屬於衛生局食品藥物管理科之「餐飲場所廚房髒亂老鼠」監管權責。',
    citizenName: '林同學',
    citizenPhone: '0978-999-000',
    location: '台北市信義區松山路 280 號',
    urgency: '一般',
    isManuallyRerouted: false,
    logs: [
      { timestamp: '2026-06-17T01:15:00.000Z', action: '案件登錄', operator: '市民林同學', details: '民眾線上陳情案件建立。' },
      { timestamp: '2026-06-17T01:17:00.000Z', action: '智能分派', operator: 'AI自動派遣引擎', details: '自適應分派至【衛生局食品藥物管理科】，置信度：97%' }
    ]
  },
  {
    id: 'case_005',
    title: '捷運站出口有街友露宿需要關懷照顧',
    description: '在古亭捷運站 2 號出口旁看到有一位白髮蒼蒼的老先生睡在紙箱上，現在天氣異常悶熱，老人家看起來很虛弱，不忍心看他流落街頭，希望能有社工或收容所人員前來協助關心安置。',
    category: '社會救助與福利',
    departmentId: 'dp_social_welfare',
    status: '待處理',
    createdAt: '2026-06-17T02:40:00.000Z',
    dispatchedAt: '2026-06-17T02:41:00.000Z',
    confidence: 0.91,
    dispatchReason: 'AI 自動定位研判：提及「捷運站街友」、「流落街頭」、「關心安置」，契合社會局社會救助科之「無家者/浪人救助與緊急安置」福利政策。',
    citizenName: '施小姐',
    citizenPhone: '0933-221-554',
    location: '台北市中正區古亭捷運站 2 號出口附近',
    urgency: '一般',
    isManuallyRerouted: false,
    logs: [
      { timestamp: '2026-06-17T02:40:00.000Z', action: '案件登錄', operator: '民眾施小姐', details: '民眾線上陳情案件建立。' },
      { timestamp: '2026-06-17T02:41:00.000Z', action: '智能分派', operator: 'AI自動派遣引擎', details: '自適應分派至【社會局社會救助科】，置信度：91%' }
    ]
  }
];

// Fallback Keyword Router
function keywordDispatchFallback(title: string, description: string): {
  category: string;
  suggestedDepartmentId: string;
  confidence: number;
  dispatchReason: string;
} {
  const content = (title + ' ' + description).toLowerCase();

  if (
    content.includes('路燈') ||
    content.includes('坑洞') ||
    content.includes('路面') ||
    content.includes('人行道') ||
    content.includes('路樹') ||
    content.includes('雨水') ||
    content.includes('排水') ||
    content.includes('公用設施') ||
    content.includes('馬路') ||
    content.includes('水溝')
  ) {
    return {
      category: '道路與公用設施',
      suggestedDepartmentId: 'dp_public_works_road',
      confidence: 0.88,
      dispatchReason: '規則比對判定：偵測到「路燈、路面、坑洞、水溝、公用設施」相關市政詞彙，判定由主掌土木建置工程之【工務局養護工程處 (養工處)】調度處理。'
    };
  }

  if (
    content.includes('噪音') ||
    content.includes('分貝') ||
    content.includes('太吵') ||
    content.includes('音量') ||
    content.includes('卡拉ok') ||
    content.includes('深夜大聲') ||
    content.includes('工地吵')
  ) {
    return {
      category: '環保與公害檢舉',
      suggestedDepartmentId: 'dp_env_noise',
      confidence: 0.89,
      dispatchReason: '規則比對判定：系統偵測到「噪音、分貝、太吵」環境侵害詞彙，將此案件自動分派於環護局專責處理之【環境保護局噪音公害管制科】辦理。'
    };
  }

  if (
    content.includes('垃圾') ||
    content.includes('髒亂') ||
    content.includes('惡臭') ||
    content.includes('小廣告') ||
    content.includes('傳單') ||
    content.includes('廢棄物') ||
    content.includes('動物') ||
    content.includes('狗屍') ||
    content.includes('死貓') ||
    content.includes('清潔')
  ) {
    return {
      category: '環境衛生與垃圾',
      suggestedDepartmentId: 'dp_env_cleaning',
      confidence: 0.87,
      dispatchReason: '規則比對判定：內容提及「垃圾、髒亂、小廣告、廢棄清運、死體」之環境公衛清理描述，快速分派至環保局之【環境保護局清潔維護科】清運。'
    };
  }

  if (
    content.includes('違停') ||
    content.includes('並排') ||
    content.includes('紅線') ||
    content.includes('號誌') ||
    content.includes('路口') ||
    content.includes('紅綠燈') ||
    content.includes('車禍') ||
    content.includes('阻塞') ||
    content.includes('塞車') ||
    content.includes('警察') ||
    content.includes('取締')
  ) {
    return {
      category: '交通違規與治安',
      suggestedDepartmentId: 'dp_police_traffic',
      confidence: 0.92,
      dispatchReason: '規則比對判定：指述包含「並排停車、違規、車禍、紅綠燈號誌」等道路動態狀況，移由警察局執法核心部門【警察局交通警察大隊】儘速前往。'
    };
  }

  if (
    content.includes('食品') ||
    content.includes('餐廳') ||
    content.includes('中毒') ||
    content.includes('衛生不良') ||
    content.includes('過期') ||
    content.includes('老鼠') ||
    content.includes('蟑螂') ||
    content.includes('吸菸') ||
    content.includes('煙害') ||
    content.includes('廚房髒')
  ) {
    return {
      category: '食品安全與公共衛生',
      suggestedDepartmentId: 'dp_health_food',
      confidence: 0.90,
      dispatchReason: '規則比對判定：內容檢舉「食品標示、衛生髒亂、過期、抽煙、集體食物中毒」等情節，歸屬於衛生局之【衛生局食品藥物管理科】安全管束。'
    };
  }

  if (
    content.includes('街友') ||
    content.includes('無家者') ||
    content.includes('遊民') ||
    content.includes('安置') ||
    content.includes('獨居') ||
    content.includes('老人') ||
    content.includes('弱勢') ||
    content.includes('救助') ||
    content.includes('受虐') ||
    content.includes('家暴')
  ) {
    return {
      category: '社會救助與福利',
      suggestedDepartmentId: 'dp_social_welfare',
      confidence: 0.86,
      dispatchReason: '規則比對判定：辨識到「街友、遊民、急難救助、獨居老人關懷、弱勢扶助」等社援情境，快速分發予社會局【社會局社會救助科】提供社工作業。'
    };
  }

  // Final fallback if nothing matches
  return {
    category: '道路與公用設施',
    suggestedDepartmentId: 'dp_public_works_road',
    confidence: 0.50,
    dispatchReason: '規則比對判定：由於未比對出特定極高關聯字詞，系統按照市政綜合流程預分派予【工務局養護工程處 (養工處)】為其先行收受初審。'
  };
}

// REST API Endpoints

// 1. Get Departments
app.get('/api/departments', (req, res) => {
  res.json(departments);
});

// 2. Get all cases (ordered by date descending)
app.get('/api/cases', (req, res) => {
  const sortedCases = [...cases].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  res.json(sortedCases);
});

// 3. Create a new case with AI Dispatch or Rule dispatch
app.post('/api/cases', async (req, res) => {
  try {
    const { title, description, citizenName, citizenPhone, location, urgency } = req.body;

    if (!title || !description) {
      res.status(400).json({ error: '陳情案件主旨與詳情描述為必填項目。' });
      return;
    }

    const caseId = 'case_' + Date.now();
    const createdAt = new Date().toISOString();

    let analysisResult;

    if (ai) {
      try {
        const systemInstruction = `
你是一位專業的市政陳情案件分析官，負責將市民投遞的「陳情案件主旨與內容」，分析分類，並對應分派至最適當的權責處理局處（部門）。

系統中可供分派的部門 ID 與主要權責如下：
1. "dp_public_works_road": 工務局養護工程處 (負責：路燈故障不亮、路面坑洞破損、人行道補修、路樹剪修傾倒、水溝堵塞不通等工程維護)
2. "dp_env_noise": 環境保護局噪音公害管制科 (負責：營建工地施工發出巨大噪音、營業或娛樂場所深夜喧嘩、擴音器喇叭震耳噪音、工廠噪音等)
3. "dp_env_cleaning": 環境保護局清潔維護科 (負責：一般街道垃圾堆積惡臭、環境髒亂、違規張貼牆面小廣告、大型家具廢棄物清運、動物死體清理等)
4. "dp_police_traffic": 警察局交通警察大隊 (負責：道路並排停車、違規停放車輛、道路或人行道障礙佔用、紅綠燈號誌故障不亮、交通事故或塞車塞爆)
5. "dp_health_food": 衛生局食品藥物管理科 (負責：餐廳廚房內部髒亂有害蟲老鼠、販售過期壞掉食品、疑似集體食物中毒事件、食品廣告標示誇大不實、室內或全面禁煙場所違法吸煙等)
6. "dp_social_welfare": 社會局社會救助科 (負責：街友/遊民低溫炎熱緊急收容安置、急難救助金申辦、長者獨居探視保障、弱勢及家庭問題通報協調)

你的任務是閱讀市民的陳情詳細，判定並輸出一個 JSON 物件，精準包含以下四個欄位，不能有其他根節點欄位：
- category: 繁體中文分類名稱（必須挑選：道路與公用設施、環保與公害檢舉、環境衛生與垃圾、交通違規與治安、食品安全與公共衛生、社會救助與福利）
- suggestedDepartmentId: 必須是上面六個部門 ID 的其中之一。
- confidence: 置信度數值 (應在 0.0 至 1.0 之間)。
- dispatchReason: 繁體中文解析，高水準說明為何分派至該單位的原因，並指出使用者內容中的特定關鍵字，使其看起來極具智慧判定特性。

嚴格遵守：請僅輸出此合規的 JSON，字串必須為繁體中文。
        `;

        const response = await ai.models.generateContent({
          model: 'gemini-3.5-flash',
          contents: `
陳情案主旨：${title}
陳情案內容：${description}
          `,
          config: {
            systemInstruction: systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                category: { type: Type.STRING },
                suggestedDepartmentId: { type: Type.STRING },
                confidence: { type: Type.NUMBER },
                dispatchReason: { type: Type.STRING }
              },
              required: ['category', 'suggestedDepartmentId', 'confidence', 'dispatchReason']
            }
          }
        });

        const jsonText = response.text?.trim() || '{}';
        analysisResult = JSON.parse(jsonText);
      } catch (geminiError) {
        console.error('Gemini API classification failed, using keyword fallback:', geminiError);
        analysisResult = keywordDispatchFallback(title, description);
        analysisResult.dispatchReason = '[AI 運算超時，啟用緊急備接規則系統] ' + analysisResult.dispatchReason;
      }
    } else {
      // No API key - standard rule based dispatch
      analysisResult = keywordDispatchFallback(title, description);
      analysisResult.dispatchReason = '[市府內網分派引擎] ' + analysisResult.dispatchReason;
    }

    // Double check suggestedDepartmentId validity
    const verifiedDeptId = departments.some(d => d.id === analysisResult.suggestedDepartmentId)
      ? analysisResult.suggestedDepartmentId
      : 'dp_public_works_road';

    const matchedDept = departments.find(d => d.id === verifiedDeptId)!;

    const baseLogs: CaseLog[] = [
      {
        timestamp: createdAt,
        action: '市民投件',
        operator: citizenName || '網路市民',
        details: `市民成功提交陳情文件，急迫性：【${urgency || '一般'}】。`
      },
      {
        timestamp: createdAt,
        action: '智慧分派',
        operator: ai ? 'AI 決策局長 (gemini-3.5-flash)' : '市府核心邏輯引擎',
        details: `系統成功完成分析，案件屬【${analysisResult.category}】領域，自動分頁發派至【${matchedDept.name}】，信心水準 ${Math.round(analysisResult.confidence * 100)}%。判斷分析: ${analysisResult.dispatchReason}`
      }
    ];

    const newCase: Case = {
      id: caseId,
      title: title,
      description: description,
      category: analysisResult.category || '道路與公用設施',
      departmentId: verifiedDeptId,
      status: '待處理',
      createdAt: createdAt,
      dispatchedAt: createdAt,
      confidence: analysisResult.confidence || 0.85,
      dispatchReason: analysisResult.dispatchReason,
      citizenName: citizenName || '匿名市民',
      citizenPhone: citizenPhone || '未留存聯絡方式',
      location: location || '台北市區 (未指定具體段落)',
      urgency: urgency || '一般',
      logs: baseLogs
    };

    cases.push(newCase);
    res.status(201).json(newCase);
  } catch (error) {
    const err = error as Error;
    console.error('Create case endpoint error:', err);
    res.status(500).json({ error: '建立陳情案件時伺服器發生異常: ' + err.message });
  }
});

// 4. Manually re-dispatch/transfer a case to another department
app.post('/api/cases/:id/dispatch', (req, res) => {
  const { id } = req.params;
  const { departmentId, reason } = req.body;

  if (!departmentId || !reason) {
    res.status(400).json({ error: '必須指定轉派之局處部門 ID 與轉派原因說明。' });
    return;
  }

  const caseItem = cases.find(c => c.id === id);
  if (!caseItem) {
    res.status(404).json({ error: '找不到該筆市民陳情案件。' });
    return;
  }

  const targetDept = departments.find(d => d.id === departmentId);
  if (!targetDept) {
    res.status(400).json({ error: '指定轉派的部門 ID 無效。' });
    return;
  }

  const prevDept = departments.find(d => d.id === caseItem.departmentId);
  const prevDeptName = prevDept ? prevDept.name : '未知權責單位';

  caseItem.departmentId = departmentId;
  caseItem.category = targetDept.category;
  caseItem.confidence = 1.0; // Manual set to full certainty
  // Mark as manually rerouted so that accuracy stat changes
  caseItem.isManuallyRerouted = true;
  caseItem.logs.push({
    timestamp: new Date().toISOString(),
    action: '局處改分',
    operator: '派工調度管理員 (Admin)',
    details: `案件重新指調分派：原權責為【${prevDeptName}】，已改分至【${targetDept.name}】處理。調度改分原因：${reason}`
  });

  res.json(caseItem);
});

// 5. Update case status (and optionally add feedback)
app.post('/api/cases/:id/status', (req, res) => {
  const { id } = req.params;
  const { status, feedback } = req.body;

  if (!status) {
    res.status(400).json({ error: '必須提供最新的案件狀態。' });
    return;
  }

  const caseItem = cases.find(c => c.id === id);
  if (!caseItem) {
    res.status(404).json({ error: '找不到該筆市民陳情案件。' });
    return;
  }

  caseItem.status = status;
  if (feedback !== undefined) {
    caseItem.feedback = feedback;
  }

  const dept = departments.find(d => d.id === caseItem.departmentId);
  const deptName = dept ? dept.name : '權責單位';

  caseItem.logs.push({
    timestamp: new Date().toISOString(),
    action: '狀態更新',
    operator: `${deptName}處理承辦員`,
    details: `案件最新進展：設定狀態為【${status}】。${feedback ? ('處置說明回覆：' + feedback) : '相關人員正調配資源深入檢修處理中。'}`
  });

  res.json(caseItem);
});

// 6. Get Analytics dashboard stats
app.get('/api/stats', (req, res) => {
  const total = cases.length;
  const pending = cases.filter(c => c.status === '待處理').length;
  const processing = cases.filter(c => c.status === '處理中').length;
  const closed = cases.filter(c => c.status === '已結案').length;

  const departmentCounts: Record<string, number> = {};
  const categoryCounts: Record<string, number> = {};
  const urgencyCounts: Record<string, number> = { '一般': 0, '緊急': 0, '特急': 0 };

  // Initialize dept counts with 0
  departments.forEach(d => {
    departmentCounts[d.id] = 0;
  });

  cases.forEach(c => {
    if (departmentCounts[c.departmentId] !== undefined) {
      departmentCounts[c.departmentId]++;
    } else {
      departmentCounts[c.departmentId] = 1;
    }

    categoryCounts[c.category] = (categoryCounts[c.category] || 0) + 1;
    if (c.urgency) {
      urgencyCounts[c.urgency] = (urgencyCounts[c.urgency] || 0) + 1;
    }
  });

  // Calculate automated accuracy rate (those which have not been manually rerouted)
  const manuallyReroutedCount = cases.filter(c => c.isManuallyRerouted).length;
  const autoSuccessfulCount = total - manuallyReroutedCount;
  const accuracyRate = total > 0 ? (autoSuccessfulCount / total) * 100 : 100;

  res.json({
    totalCases: total,
    statusCounts: {
      pending,
      processing,
      closed
    },
    departmentCounts,
    categoryCounts,
    urgencyCounts,
    accuracyRate: Math.round(accuracyRate * 10) / 10,
    apiMode: ai ? 'AI 語意大模型增強 (gemini-3.5-flash)' : '本地智慧規則比對引擎'
  });
});

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
