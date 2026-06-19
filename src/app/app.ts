import { ChangeDetectionStrategy, Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { forkJoin } from 'rxjs';

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

interface Stats {
  totalCases: number;
  accuracyRate: number;
  statusCounts: {
    pending: number;
    processing: number;
    closed: number;
  };
  apiMode: string;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-root',
  imports: [CommonModule, ReactiveFormsModule, MatIconModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  private http = inject(HttpClient);
  private fb = inject(FormBuilder);

  Math = Math;

  getCountByStatus(status: '待處理' | '處理中' | '已結案'): number {
    return this.cases().filter(c => c.status === status).length;
  }

  // App Layout State
  activeTab = signal<'citizen' | 'admin' | 'rules'>('citizen');
  isLoading = signal<boolean>(false);
  isSubmitting = signal<boolean>(false);

  // Form Groups
  citizenForm!: FormGroup;
  rerouteForm!: FormGroup;
  statusForm!: FormGroup;

  // Database Signals
  departments = signal<Department[]>([]);
  cases = signal<Case[]>([]);
  selectedCase = signal<Case | null>(null);
  stats = signal<Stats | null>(null);

  // User Interactive States
  dispatchFeedback = signal<Case | null>(null);
  searchQuery = signal<string>('');
  statusFilter = signal<string>('ALL');

  // Computed Filters
  filteredCases = computed(() => {
    let list = this.cases();
    const filter = this.statusFilter();
    const query = this.searchQuery().trim().toLowerCase();

    if (filter !== 'ALL') {
      list = list.filter(c => c.status === filter);
    }
    if (query) {
      list = list.filter(c =>
        c.title.toLowerCase().includes(query) ||
        c.description.toLowerCase().includes(query) ||
        c.id.toLowerCase().includes(query) ||
        (c.location && c.location.toLowerCase().includes(query)) ||
        c.category.toLowerCase().includes(query)
      );
    }
    return list;
  });

  // Setup sample address autofills for a smooth demo
  sampleAddresses = [
    '台北市大安區新生南路二段 1 號 (大安森林公園旁)',
    '台北市信義區市府路 1 號 (市府大樓前)',
    '台北市中山區中山北路二段 48 號',
    '台北市萬華區廣州街 211 號 (龍山寺周邊)',
    '台北市中正區羅斯福路四段 1 號'
  ];

  ngOnInit() {
    this.initForms();
    this.loadInitialData();
  }

  // Initialize Forms strictly using Reactive Forms API
  private initForms() {
    this.citizenForm = this.fb.group({
      title: ['', [Validators.required, Validators.minLength(4)]],
      description: ['', [Validators.required, Validators.minLength(10)]],
      citizenName: ['', Validators.required],
      citizenPhone: ['', [Validators.required, Validators.pattern(/^[0-9\-+()# ]{8,15}$/)]],
      location: ['', Validators.required],
      urgency: ['一般', Validators.required]
    });

    this.rerouteForm = this.fb.group({
      targetDepartmentId: ['', Validators.required],
      rerouteReason: ['', [Validators.required, Validators.minLength(4)]]
    });

    this.statusForm = this.fb.group({
      newStatus: ['處理中', Validators.required],
      feedback: ['', [Validators.required, Validators.minLength(4)]]
    });
  }

  // Fetch all initial data using forkJoin in parallel
  loadInitialData() {
    this.isLoading.set(true);
    forkJoin({
      depts: this.http.get<Department[]>('/api/departments'),
      casesList: this.http.get<Case[]>('/api/cases'),
      statsData: this.http.get<Stats>('/api/stats')
    }).subscribe({
      next: (res) => {
        this.departments.set(res.depts);
        this.cases.set(res.casesList);
        this.stats.set(res.statsData);

        if (res.casesList.length > 0) {
          this.selectedCase.set(res.casesList[0]);
        }
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Failed to load municipal initial data', err);
        this.isLoading.set(false);
      }
    });
  }

  // Refresh Stats Dashboard
  loadStats() {
    this.http.get<Stats>('/api/stats').subscribe({
      next: (res) => this.stats.set(res),
      error: (err) => console.error('Failed to refresh statistics', err)
    });
  }

  // Trigger geolocation integration simulation
  autofillCurrentLocation() {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          // Fill template mock coordinate
          const lat = position.coords.latitude.toFixed(5);
          const lng = position.coords.longitude.toFixed(5);
          const randomAddr = this.sampleAddresses[Math.floor(Math.random() * this.sampleAddresses.length)];
          this.citizenForm.patchValue({
            location: `${randomAddr} (GPS 緯度: ${lat}, 經度: ${lng})`
          });
        },
        () => {
          const randomAddr = this.sampleAddresses[Math.floor(Math.random() * this.sampleAddresses.length)];
          this.citizenForm.patchValue({
            location: randomAddr
          });
        }
      );
    } else {
      const randomAddr = this.sampleAddresses[Math.floor(Math.random() * this.sampleAddresses.length)];
      this.citizenForm.patchValue({
        location: randomAddr
      });
    }
  }

  // Register municipal citizen input
  submitCitizenCase() {
    if (this.citizenForm.invalid) {
      this.citizenForm.markAllAsTouched();
      return;
    }

    this.isSubmitting.set(true);
    this.dispatchFeedback.set(null);

    this.http.post<Case>('/api/cases', this.citizenForm.value).subscribe({
      next: (newCase) => {
        this.citizenForm.reset({ urgency: '一般' });
        this.cases.update((list) => [newCase, ...list]);
        this.selectedCase.set(newCase);
        this.dispatchFeedback.set(newCase);
        this.isSubmitting.set(false);
        this.loadStats();
      },
      error: (err) => {
        console.error('Failed to submit citizen case', err);
        this.isSubmitting.set(false);
        alert('陳情遞交異常：伺服器解析失敗，請重新確認填寫內容。');
      }
    });
  }

  // Re-route manually
  submitReroute() {
    const activeCase = this.selectedCase();
    if (!activeCase) return;

    if (this.rerouteForm.invalid) {
      this.rerouteForm.markAllAsTouched();
      return;
    }

    const { targetDepartmentId, rerouteReason } = this.rerouteForm.value;

    this.http.post<Case>(`/api/cases/${activeCase.id}/dispatch`, {
      departmentId: targetDepartmentId,
      reason: rerouteReason
    }).subscribe({
      next: (updatedCase) => {
        this.cases.update((list) => list.map(c => c.id === updatedCase.id ? updatedCase : c));
        this.selectedCase.set(updatedCase);
        this.rerouteForm.reset();
        this.loadStats();
      },
      error: (err) => {
        console.error('Manual reroute failed', err);
        alert('人工改分派單發生異常，請重試。');
      }
    });
  }

  // Update Status & resolve feedback
  submitStatusUpdate() {
    const activeCase = this.selectedCase();
    if (!activeCase) return;

    if (this.statusForm.invalid) {
      this.statusForm.markAllAsTouched();
      return;
    }

    const { newStatus, feedback } = this.statusForm.value;

    this.http.post<Case>(`/api/cases/${activeCase.id}/status`, {
      status: newStatus,
      feedback: feedback
    }).subscribe({
      next: (updatedCase) => {
        this.cases.update((list) => list.map(c => c.id === updatedCase.id ? updatedCase : c));
        this.selectedCase.set(updatedCase);
        this.statusForm.reset({ newStatus: '已結案' });
        this.loadStats();
      },
      error: (err) => {
        console.error('Status updating failed', err);
        alert('狀態更新回報發生異常，請重試。');
      }
    });
  }

  // Helper getters
  getDeptName(id: string): string {
    const dept = this.departments().find(d => d.id === id);
    return dept ? dept.name : '未分派單位';
  }

  getDeptActiveCount(deptId: string): number {
    return this.cases().filter(c => c.departmentId === deptId).length;
  }

  // Simple quick seed generators for demo convenience
  autofillDemoCase(type: ' streetlight' | 'noise' | 'food' | 'dogs') {
    const mockDataMap = {
      ' streetlight': {
        title: '內湖大湖街 120 巷口路燈故障不亮',
        description: '大湖街 120 巷口那盞黃色路燈已經閃爍快一週了，昨晚完全不亮。這條巷子很多人晚上散步或帶小孩，沒有路燈非常黑，很容易在轉角滑倒掉進旁邊排水溝，希望養工處工班能來維修。',
        citizenName: '曾義雄',
        citizenPhone: '0977-888-999',
        location: '台北市內湖區大湖街 120 巷口',
        urgency: '緊急'
      },
      'noise': {
        title: '忠孝東路四段商業大樓周邊工地深夜施工大噪',
        description: '在忠孝東路四段這邊的商業大樓旁邊，都已經超過晚上 11:30 了，工地居然還在用重型吊車與挖土機，鋼材震動鏗鏘作響，分貝超級大根本無法安心睡覺，打過去勸導都沒用，請環保局立刻來量音量與限期取締改善。',
        citizenName: '林曉梅',
        citizenPhone: '0956-254-152',
        location: '台北市大安區忠孝東路四段 210 號旁工地',
        urgency: '特急'
      },
      'food': {
        title: '饒河夜市某連鎖牛排熟食發霉且環境髒亂',
        description: '昨晚到饒河夜市這家連鎖牛排用餐，上餐發現玉米濃湯盤底居然黑黑一片疑似沒洗乾淨，調味料瓶蓋上甚至有一層白色黴菌！洗碗的地方有蒼蠅嗡嗡飛，回家後半夜拉了兩次肚子，高度懷疑食物中毒，請抽查檢驗。',
        citizenName: '楊先生',
        citizenPhone: '0911-365-248',
        location: '台北市松山區饒河街 150 號',
        urgency: '一般'
      },
      'dogs': {
        title: '興隆路二段公園人行道有死貓死狗屍體需要清理',
        description: '在興隆路二段隔壁社區公園的外圍人行道草叢旁，有一隻流浪貓不幸死亡躺在地上。今天天氣太熱了，已經發出明顯的異味與招引蒼蠅，非常影響市容與公共環境衛生，請清潔隊盡快派車來清理遺體。',
        citizenName: '陳鄰長',
        citizenPhone: '0988-332-114',
        location: '台北市文山區興隆路二段 60 號公園人行道旁',
        urgency: '緊急'
      }
    };

    const targetData = mockDataMap[type];
    if (targetData) {
      this.citizenForm.patchValue(targetData);
    }
  }

  // Switch tab with helper clear
  selectTab(tab: 'citizen' | 'admin' | 'rules') {
    this.activeTab.set(tab);
    if (tab === 'admin' && this.cases().length > 0 && !this.selectedCase()) {
      this.selectedCase.set(this.cases()[0]);
    }
  }
}
