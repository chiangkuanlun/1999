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
  MunicipalCase,
  Organization,
  ReferenceCase,
  Stats,
} from './models';

type Tab = 'intake' | 'cases' | 'departments' | 'references' | 'organizations';

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
  readonly organizations = signal<Organization[]>([]);
  readonly selectedOrganizationId = signal('');
  readonly departments = signal<Department[]>([]);
  readonly referenceCases = signal<ReferenceCase[]>([]);
  readonly cases = signal<MunicipalCase[]>([]);
  readonly selectedCase = signal<MunicipalCase | null>(null);
  readonly dispatchResult = signal<MunicipalCase | null>(null);
  readonly stats = signal<Stats | null>(null);
  readonly search = signal('');

  readonly activeDepartments = computed(() =>
    this.departments().filter((department) => department.isActive),
  );
  readonly filteredCases = computed(() => {
    const query = this.search().trim().toLowerCase();
    if (!query) {
      return this.cases();
    }
    return this.cases().filter((caseItem) =>
      [caseItem.id, caseItem.externalId, caseItem.title, caseItem.description, caseItem.location]
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
    this.message.set('');
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
        this.message.set('無法載入使用機關。');
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
        `/api/reference-cases?organizationId=${encodeURIComponent(organizationId)}`,
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
        this.referenceCases.set(result.references);
        this.cases.set(result.cases);
        this.stats.set(result.stats);
        this.selectedCase.set(result.cases[0] ?? null);
        this.loading.set(false);
      },
      error: () => {
        this.message.set('載入機關資料失敗。');
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
        this.message.set('使用機關已儲存。');
        this.saving.set(false);
        this.loadOrganizations(organization.id);
      },
      error: (error: { error?: { error?: string } }) => {
        this.message.set(error.error?.error ?? '儲存使用機關失敗。');
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
        this.message.set('責任局處已儲存。');
        this.saving.set(false);
        this.loadOrganizationData();
      },
      error: (error: { error?: { error?: string } }) => {
        this.message.set(error.error?.error ?? '儲存責任局處失敗。');
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
  }

  toggleDepartment(department: Department): void {
    this.http.put<Department>(`/api/departments/${department.id}`, {
      isActive: !department.isActive,
    }).subscribe({
      next: () => this.loadOrganizationData(),
      error: () => this.message.set('切換局處狀態失敗。'),
    });
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
        this.message.set('參考案例已新增。');
        this.saving.set(false);
        this.loadOrganizationData();
      },
      error: (error: { error?: { error?: string } }) => {
        this.message.set(error.error?.error ?? '新增參考案例失敗。');
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
          this.message.set(`已匯入 ${result.imported} 筆${errorText}`);
          this.saving.set(false);
          input.value = '';
          this.loadOrganizationData();
        },
        error: (error: { error?: { error?: string } }) => {
          this.message.set(error.error?.error ?? 'CSV 匯入失敗。');
          this.saving.set(false);
        },
      });
    });
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
        this.refreshStats();
      },
      error: (error: { error?: { error?: string } }) => {
        this.message.set(error.error?.error ?? '建立案件失敗。');
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
    this.http.post<MunicipalCase>(`/api/cases/${caseItem.id}/dispatch`, {
      ...this.rerouteForm.getRawValue(),
      operator: '管理者',
    }).subscribe({
      next: (updated) => this.replaceCase(updated, '案件已人工改派。'),
      error: (error: { error?: { error?: string } }) =>
        this.message.set(error.error?.error ?? '人工改派失敗。'),
    });
  }

  updateStatus(): void {
    const caseItem = this.selectedCase();
    if (!caseItem || this.statusForm.invalid) {
      return;
    }
    this.http.post<MunicipalCase>(`/api/cases/${caseItem.id}/status`, {
      ...this.statusForm.getRawValue(),
      operator: '承辦人員',
    }).subscribe({
      next: (updated) => this.replaceCase(updated, '案件狀態已更新。'),
      error: () => this.message.set('更新案件狀態失敗。'),
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
    this.message.set(message);
    this.refreshStats();
  }

  private refreshStats(): void {
    const organizationId = this.selectedOrganizationId();
    this.http.get<Stats>(
      `/api/stats?organizationId=${encodeURIComponent(organizationId)}`,
    ).subscribe((stats) => this.stats.set(stats));
  }
}
