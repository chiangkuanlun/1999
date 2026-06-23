import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { forkJoin } from 'rxjs';
import {
  Department,
  HistoricalWorkbookPreview,
  MunicipalCase,
  Organization,
  ReferenceCase,
  Stats,
} from './models';

type Tab = 'intake' | 'cases' | 'departments' | 'references' | 'organizations';
type NoticeKind = 'success' | 'error' | 'info';
type CaseStatusFilter = '全部' | MunicipalCase['status'] | '人工覆核';

@Component({
  selector: 'app-root',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly fb = inject(FormBuilder);
  private readonly platformId = inject(PLATFORM_ID);

  readonly activeTab = signal<Tab>('intake');
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly message = signal('');
  readonly noticeKind = signal<NoticeKind>('info');
  readonly organizations = signal<Organization[]>([]);
  readonly selectedOrganizationId = signal('');
  readonly departments = signal<Department[]>([]);
  readonly referenceCases = signal<ReferenceCase[]>([]);
  readonly referenceTotal = signal(0);
  readonly cases = signal<MunicipalCase[]>([]);
  readonly selectedCase = signal<MunicipalCase | null>(null);
  readonly dispatchResult = signal<MunicipalCase | null>(null);
  readonly stats = signal<Stats | null>(null);
  readonly search = signal('');
  readonly caseStatusFilter = signal<CaseStatusFilter>('全部');
  readonly referenceSearch = signal('');
  readonly expandedDepartmentId = signal('');
  readonly excelFileName = signal('');
  readonly excelFileBuffer = signal<ArrayBuffer | null>(null);
  readonly excelPreview = signal<HistoricalWorkbookPreview | null>(null);

  readonly selectedOrganization = computed(() =>
    this.organizations().find((organization) =>
      organization.id === this.selectedOrganizationId()) ?? null,
  );
  readonly activeDepartments = computed(() =>
    this.departments().filter((department) => department.isActive),
  );
  readonly filteredCases = computed(() => {
    const query = this.search().trim().toLowerCase();
    const filter = this.caseStatusFilter();
    return this.cases().filter((caseItem) => {
      const matchesQuery = !query ||
        [caseItem.id, caseItem.externalId, caseItem.title, caseItem.description, caseItem.location]
          .some((value) => value?.toLowerCase().includes(query));
      const matchesStatus = filter === '全部' ||
        (filter === '人工覆核'
          ? caseItem.assignmentMode === 'manual_review'
          : caseItem.status === filter);
      return matchesQuery && matchesStatus;
    });
  });
  readonly filteredReferenceCases = computed(() => {
    const query = this.referenceSearch().trim().toLowerCase();
    if (!query) {
      return this.referenceCases();
    }
    return this.referenceCases().filter((reference) =>
      [reference.externalId, reference.title, reference.description, this.referenceDepartmentName(reference)]
        .some((value) => value?.toLowerCase().includes(query)),
    );
  });

  readonly organizationForm = this.fb.nonNullable.group({
    id: [''],
    code: ['', Validators.required],
    name: ['', Validators.required],
    assignmentThreshold: [0.25, [Validators.required, Validators.min(0), Validators.max(1)]],
    isActive: [true],
  });

  readonly departmentForm = this.fb.nonNullable.group({
    id: [''],
    code: ['', Validators.required],
    name: ['', Validators.required],
    category: ['', Validators.required],
    responsibilities: ['', Validators.required],
    keywords: ['', Validators.required],
    contact: [''],
    isActive: [true],
  });

  readonly referenceForm = this.fb.nonNullable.group({
    externalId: [''],
    departmentId: ['', Validators.required],
    title: ['', Validators.required],
    description: ['', Validators.required],
  });

  readonly caseForm = this.fb.nonNullable.group({
    externalId: [''],
    citizenName: [''],
    citizenPhone: [''],
    location: [''],
    urgency: ['一般' as MunicipalCase['urgency'], Validators.required],
    title: ['', [Validators.required, Validators.minLength(3)]],
    description: ['', [Validators.required, Validators.minLength(6)]],
  });

  readonly rerouteForm = this.fb.nonNullable.group({
    departmentId: ['', Validators.required],
    reason: ['', [Validators.required, Validators.minLength(3)]],
  });

  readonly statusForm = this.fb.nonNullable.group({
    status: ['處理中' as MunicipalCase['status'], Validators.required],
    feedback: [''],
  });

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.loadOrganizations();
    }
  }

  selectTab(tab: Tab): void {
    this.activeTab.set(tab);
    this.clearMessage();
  }

  clearMessage(): void {
    this.message.set('');
  }

  showMessage(message: string, kind: NoticeKind = 'info'): void {
    this.noticeKind.set(kind);
    this.message.set(message);
  }

  fieldInvalid(formName: 'case' | 'department' | 'reference' | 'organization', field: string): boolean {
    const control = formName === 'case'
      ? this.caseForm.get(field)
      : formName === 'department'
        ? this.departmentForm.get(field)
        : formName === 'reference'
          ? this.referenceForm.get(field)
          : this.organizationForm.get(field);
    return Boolean(control?.invalid && (control.dirty || control.touched));
  }

  fillSampleCase(type: 'road' | 'environment'): void {
    const samples = {
      road: {
        externalId: `DEMO-${new Date().getTime().toString().slice(-6)}`,
        citizenName: '測試市民',
        citizenPhone: '0900-000-000',
        location: '中正路與和平路口',
        urgency: '緊急' as const,
        title: '道路出現大型坑洞',
        description: '中正路與和平路口的柏油路面出現大型坑洞，車輛經過時容易發生危險，請儘速派員修補。',
      },
      environment: {
        externalId: `DEMO-${new Date().getTime().toString().slice(-6)}`,
        citizenName: '測試市民',
        citizenPhone: '0900-000-000',
        location: '公園路二段巷口',
        urgency: '一般' as const,
        title: '路旁堆積大量垃圾',
        description: '公園路二段巷口堆放大型廢棄物與生活垃圾，已有異味並影響環境清潔，請協助清運。',
      },
    };
    this.caseForm.setValue(samples[type]);
    this.caseForm.markAsDirty();
    this.dispatchResult.set(null);
  }

  viewDispatchResult(): void {
    const result = this.dispatchResult();
    if (!result) {
      return;
    }
    this.selectCase(result);
    this.activeTab.set('cases');
  }

  loadOrganizations(preferredId?: string): void {
    this.loading.set(true);
    this.http.get<Organization[]>('/api/organizations').subscribe({
      next: (organizations) => {
        this.organizations.set(organizations);
        const selected =
          organizations.find((item) => item.id === preferredId) ??
          organizations.find((item) => item.isActive) ??
          organizations[0];
        this.selectedOrganizationId.set(selected?.id ?? '');
        if (selected) {
          this.loadOrganizationData();
        } else {
          this.loading.set(false);
        }
      },
      error: () => {
        this.showMessage('無法載入使用機關。', 'error');
        this.loading.set(false);
      },
    });
  }

  changeOrganization(organizationId: string): void {
    this.selectedOrganizationId.set(organizationId);
    this.selectedCase.set(null);
    this.dispatchResult.set(null);
    this.loadOrganizationData();
  }

  loadOrganizationData(): void {
    const organizationId = this.selectedOrganizationId();
    if (!organizationId) {
      return;
    }
    this.loading.set(true);
    forkJoin({
      departments: this.http.get<Department[]>(
        `/api/departments?organizationId=${encodeURIComponent(organizationId)}`,
      ),
      references: this.http.get<ReferenceCase[]>(
        `/api/reference-cases?organizationId=${encodeURIComponent(organizationId)}&limit=500`,
        { observe: 'response' },
      ),
      cases: this.http.get<MunicipalCase[]>(
        `/api/cases?organizationId=${encodeURIComponent(organizationId)}`,
      ),
      stats: this.http.get<Stats>(
        `/api/stats?organizationId=${encodeURIComponent(organizationId)}`,
      ),
    }).subscribe({
      next: (result) => {
        this.departments.set(result.departments);
        this.referenceCases.set(result.references.body ?? []);
        this.referenceTotal.set(
          Number(result.references.headers.get('X-Total-Count')) ||
          result.references.body?.length ||
          0,
        );
        this.cases.set(result.cases);
        this.stats.set(result.stats);
        this.selectedCase.set(result.cases[0] ?? null);
        this.loading.set(false);
      },
      error: () => {
        this.showMessage('載入機關資料失敗。', 'error');
        this.loading.set(false);
      },
    });
  }

  saveOrganization(): void {
    if (this.organizationForm.invalid) {
      this.organizationForm.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    const value = this.organizationForm.getRawValue();
    const request = value.id
      ? this.http.put<Organization>(`/api/organizations/${value.id}`, value)
      : this.http.post<Organization>('/api/organizations', value);
    request.subscribe({
      next: (organization) => {
        this.organizationForm.reset({
          id: '',
          code: '',
          name: '',
          assignmentThreshold: 0.25,
          isActive: true,
        });
        this.showMessage('使用機關已儲存。', 'success');
        this.saving.set(false);
        this.loadOrganizations(organization.id);
      },
      error: (error: { error?: { error?: string } }) => {
        this.showMessage(error.error?.error ?? '儲存使用機關失敗。', 'error');
        this.saving.set(false);
      },
    });
  }

  editOrganization(organization: Organization): void {
    this.organizationForm.setValue({
      id: organization.id,
      code: organization.code,
      name: organization.name,
      assignmentThreshold: organization.assignmentThreshold,
      isActive: organization.isActive,
    });
    this.showMessage(`正在編輯「${organization.name}」。`, 'info');
  }

  resetOrganizationForm(): void {
    this.organizationForm.reset({
      id: '',
      code: '',
      name: '',
      assignmentThreshold: 0.25,
      isActive: true,
    });
  }

  toggleOrganization(organization: Organization): void {
    this.saving.set(true);
    this.http.put<Organization>(`/api/organizations/${organization.id}`, {
      isActive: !organization.isActive,
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.showMessage(
          `${organization.name}已${organization.isActive ? '停用' : '啟用'}。`,
          'success',
        );
        this.loadOrganizations(this.selectedOrganizationId());
      },
      error: () => {
        this.saving.set(false);
        this.showMessage('切換機關狀態失敗。', 'error');
      },
    });
  }

  saveDepartment(): void {
    if (this.departmentForm.invalid || !this.selectedOrganizationId()) {
      this.departmentForm.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    const value = this.departmentForm.getRawValue();
    const payload = {
      ...value,
      organizationId: this.selectedOrganizationId(),
    };
    const request = value.id
      ? this.http.put<Department>(`/api/departments/${value.id}`, payload)
      : this.http.post<Department>('/api/departments', payload);
    request.subscribe({
      next: () => {
        this.resetDepartmentForm();
        this.showMessage('責任局處已儲存。', 'success');
        this.saving.set(false);
        this.loadOrganizationData();
      },
      error: (error: { error?: { error?: string } }) => {
        this.showMessage(error.error?.error ?? '儲存責任局處失敗。', 'error');
        this.saving.set(false);
      },
    });
  }

  editDepartment(department: Department): void {
    this.departmentForm.setValue({
      id: department.id,
      code: department.code,
      name: department.name,
      category: department.category,
      responsibilities: department.responsibilities.join('，'),
      keywords: department.keywords.join('，'),
      contact: department.contact,
      isActive: department.isActive,
    });
    this.expandedDepartmentId.set(department.id);
    this.showMessage(`正在編輯「${department.name}」。`, 'info');
  }

  toggleDepartment(department: Department): void {
    this.saving.set(true);
    this.http.put<Department>(`/api/departments/${department.id}`, {
      isActive: !department.isActive,
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.showMessage(
          `${department.name}已${department.isActive ? '停用' : '啟用'}。`,
          'success',
        );
        this.loadOrganizationData();
      },
      error: () => {
        this.saving.set(false);
        this.showMessage('切換局處狀態失敗。', 'error');
      },
    });
  }

  toggleDepartmentDetails(departmentId: string): void {
    this.expandedDepartmentId.update((current) => current === departmentId ? '' : departmentId);
  }

  resetDepartmentForm(): void {
    this.departmentForm.reset({
      id: '',
      code: '',
      name: '',
      category: '',
      responsibilities: '',
      keywords: '',
      contact: '',
      isActive: true,
    });
  }

  saveReference(): void {
    if (this.referenceForm.invalid || !this.selectedOrganizationId()) {
      this.referenceForm.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.http.post<ReferenceCase>('/api/reference-cases', {
      ...this.referenceForm.getRawValue(),
      organizationId: this.selectedOrganizationId(),
    }).subscribe({
      next: () => {
        this.referenceForm.reset({
          externalId: '',
          departmentId: '',
          title: '',
          description: '',
        });
        this.showMessage('參考案例已新增。', 'success');
        this.saving.set(false);
        this.loadOrganizationData();
      },
      error: (error: { error?: { error?: string } }) => {
        this.showMessage(error.error?.error ?? '新增參考案例失敗。', 'error');
        this.saving.set(false);
      },
    });
  }

  importCsv(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !this.selectedOrganizationId()) {
      return;
    }
    file.text().then((csvText) => {
      this.saving.set(true);
      this.http.post<{ imported: number; errors: { row: number; message: string }[] }>(
        '/api/reference-cases/import',
        { organizationId: this.selectedOrganizationId(), csvText },
      ).subscribe({
        next: (result) => {
          const errorText = result.errors.length
            ? `；${result.errors.map((item) => `第${item.row}列 ${item.message}`).join('、')}`
            : '';
          this.showMessage(
            `已匯入 ${result.imported} 筆${errorText}`,
            result.errors.length ? 'info' : 'success',
          );
          this.saving.set(false);
          input.value = '';
          this.loadOrganizationData();
        },
        error: (error: { error?: { error?: string } }) => {
          this.showMessage(error.error?.error ?? 'CSV 匯入失敗。', 'error');
          this.saving.set(false);
        },
      });
    });
  }

  previewExcel(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !this.selectedOrganizationId()) {
      return;
    }
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      this.showMessage('請選擇 .xlsx 格式的 Excel 檔案。', 'error');
      input.value = '';
      return;
    }
    this.saving.set(true);
    this.excelPreview.set(null);
    file.arrayBuffer().then((buffer) => {
      this.http.post<HistoricalWorkbookPreview>(
        '/api/reference-cases/xlsx/preview',
        buffer,
        {
          params: { organizationId: this.selectedOrganizationId() },
          headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
        },
      ).subscribe({
        next: (preview) => {
          this.excelFileName.set(file.name);
          this.excelFileBuffer.set(buffer);
          this.excelPreview.set(preview);
          this.saving.set(false);
          this.showMessage(
            `已讀取 ${preview.rawRows.toLocaleString()} 筆流程紀錄，合併為 ${preview.uniqueCases.toLocaleString()} 件案例。`,
            'success',
          );
        },
        error: (error: { error?: { error?: string } }) => {
          this.saving.set(false);
          this.excelFileName.set('');
          this.excelFileBuffer.set(null);
          this.showMessage(error.error?.error ?? 'Excel 檔案解析失敗。', 'error');
          input.value = '';
        },
      });
    }).catch(() => {
      this.saving.set(false);
      this.showMessage('無法讀取 Excel 檔案。', 'error');
    });
  }

  importExcel(): void {
    const buffer = this.excelFileBuffer();
    if (!buffer || !this.selectedOrganizationId()) {
      this.showMessage('請先選擇並預覽 Excel 檔案。', 'error');
      return;
    }
    this.saving.set(true);
    this.http.post<{
      imported: number;
      duplicateCases: number;
      skippedRows: number;
      rawRows: number;
      duplicateWorkflowRows: number;
      createdDepartments: string[];
    }>(
      '/api/reference-cases/xlsx/import',
      buffer,
      {
        params: { organizationId: this.selectedOrganizationId() },
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      },
    ).subscribe({
      next: (result) => {
        this.saving.set(false);
        this.excelFileName.set('');
        this.excelFileBuffer.set(null);
        this.excelPreview.set(null);
        const departmentText = result.createdDepartments.length
          ? `，並建立 ${result.createdDepartments.length} 個責任局處`
          : '';
        this.showMessage(
          `已匯入 ${result.imported.toLocaleString()} 件歷史案例${departmentText}；略過 ${result.duplicateCases.toLocaleString()} 件既有案例。`,
          'success',
        );
        this.loadOrganizationData();
      },
      error: (error: { error?: { error?: string } }) => {
        this.saving.set(false);
        this.showMessage(error.error?.error ?? 'Excel 匯入失敗。', 'error');
      },
    });
  }

  clearExcelSelection(input?: HTMLInputElement): void {
    this.excelFileName.set('');
    this.excelFileBuffer.set(null);
    this.excelPreview.set(null);
    if (input) {
      input.value = '';
    }
  }

  submitCase(): void {
    if (this.caseForm.invalid || !this.selectedOrganizationId()) {
      this.caseForm.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.http.post<MunicipalCase>('/api/cases', {
      ...this.caseForm.getRawValue(),
      organizationId: this.selectedOrganizationId(),
    }).subscribe({
      next: (caseItem) => {
        this.caseForm.reset({
          externalId: '',
          citizenName: '',
          citizenPhone: '',
          location: '',
          urgency: '一般',
          title: '',
          description: '',
        });
        this.dispatchResult.set(caseItem);
        this.selectedCase.set(caseItem);
        this.cases.update((items) => [caseItem, ...items]);
        this.saving.set(false);
        this.showMessage(
          caseItem.assignmentMode === 'auto'
            ? `案件已自動分派至${this.departmentName(caseItem.departmentId)}。`
            : '案件信心分數未達門檻，已送交人工覆核。',
          caseItem.assignmentMode === 'auto' ? 'success' : 'info',
        );
        this.refreshStats();
      },
      error: (error: { error?: { error?: string } }) => {
        this.showMessage(error.error?.error ?? '建立案件失敗。', 'error');
        this.saving.set(false);
      },
    });
  }

  selectCase(caseItem: MunicipalCase): void {
    this.selectedCase.set(caseItem);
    this.rerouteForm.reset({ departmentId: '', reason: '' });
    this.statusForm.reset({ status: caseItem.status, feedback: caseItem.feedback ?? '' });
  }

  rerouteCase(): void {
    const caseItem = this.selectedCase();
    if (!caseItem || this.rerouteForm.invalid) {
      this.rerouteForm.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.http.post<MunicipalCase>(`/api/cases/${caseItem.id}/dispatch`, {
      ...this.rerouteForm.getRawValue(),
      operator: '管理者',
    }).subscribe({
      next: (updated) => {
        this.saving.set(false);
        this.rerouteForm.reset({ departmentId: '', reason: '' });
        this.replaceCase(updated, '案件已人工改派。');
      },
      error: (error: { error?: { error?: string } }) => {
        this.saving.set(false);
        this.showMessage(error.error?.error ?? '人工改派失敗。', 'error');
      },
    });
  }

  updateStatus(): void {
    const caseItem = this.selectedCase();
    if (!caseItem || this.statusForm.invalid) {
      return;
    }
    this.saving.set(true);
    this.http.post<MunicipalCase>(`/api/cases/${caseItem.id}/status`, {
      ...this.statusForm.getRawValue(),
      operator: '承辦人員',
    }).subscribe({
      next: (updated) => {
        this.saving.set(false);
        this.replaceCase(updated, '案件狀態已更新。');
      },
      error: () => {
        this.saving.set(false);
        this.showMessage('更新案件狀態失敗。', 'error');
      },
    });
  }

  departmentName(departmentId?: string): string {
    if (!departmentId) {
      return '待人工覆核';
    }
    return this.departments().find((item) => item.id === departmentId)?.name ?? '未知局處';
  }

  referenceDepartmentName(reference: ReferenceCase): string {
    return this.departmentName(reference.departmentId);
  }

  private replaceCase(updated: MunicipalCase, message: string): void {
    this.cases.update((items) =>
      items.map((item) => item.id === updated.id ? updated : item),
    );
    this.selectedCase.set(updated);
    this.showMessage(message, 'success');
    this.refreshStats();
  }

  private refreshStats(): void {
    const organizationId = this.selectedOrganizationId();
    this.http.get<Stats>(
      `/api/stats?organizationId=${encodeURIComponent(organizationId)}`,
    ).subscribe((stats) => this.stats.set(stats));
  }
}
