import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient()],
    }).compileComponents();
  });

  it('should create the configurable case routing app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
    expect(fixture.componentInstance.activeTab()).toBe('intake');
  });

  it('fills an interactive sample case and can navigate tabs', () => {
    const fixture = TestBed.createComponent(App);
    const component = fixture.componentInstance;

    component.fillSampleCase('road');
    expect(component.caseForm.controls.title.value).toContain('坑洞');
    expect(component.caseForm.controls.description.value.length).toBeGreaterThan(6);

    component.selectTab('cases');
    expect(component.activeTab()).toBe('cases');
  });

  it('shows validation state after a required form is touched', () => {
    const fixture = TestBed.createComponent(App);
    const component = fixture.componentInstance;

    component.caseForm.controls.title.setValue('');
    component.caseForm.controls.title.markAsTouched();

    expect(component.fieldInvalid('case', 'title')).toBe(true);
  });

  it('wires the quick sample button to the visible case form', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
    ) as HTMLButtonElement[];
    const roadSampleButton = buttons.find((button) => button.textContent?.includes('道路坑洞'));

    expect(roadSampleButton).toBeTruthy();
    roadSampleButton?.click();
    fixture.detectChanges();

    const titleInput = fixture.nativeElement.querySelector(
      'input[formControlName="title"]',
    ) as HTMLInputElement;
    expect(titleInput.value).toContain('坑洞');
  });
});
