// TODO: MOVE TO LIBRARY

import { AbstractControl, FormGroup } from '@angular/forms';
import { DoCheck, OnInit } from '@angular/core';
import { Observable } from 'rxjs';
import { debounceTime, filter, finalize, switchMap, tap } from 'rxjs/operators';
import { DetailComponent } from './detail.component';
import { IIdObject } from 'communication';
import { difference } from './difference';

export interface IErrorMessage {
    [error: string]: string | IErrorMessage;
}

export class DefaultErrorHandler {
    constructor(private component: { _getError: (key: string, errors: any) => string }) {

    }

    getError(key: string, errors: any): string {
        return this.component._getError(key, errors);
    }
}

export class TranslateErrorHandler {
    constructor(private _suffix: string) {

    }

    getError(key: string, errors: any): string {
        const errorKey = Object.keys(errors)[0];

        return `${this._suffix ? `${this._suffix}.` : ''}${key}.${errorKey}`;
    }
}

export interface IErrorHandler {
    getError(key: string, errors: any): string;
}

export abstract class FormComponent<T extends IIdObject> extends DetailComponent<T> implements OnInit, DoCheck {
    loadDataOnInit = false;
    form: FormGroup;

    errorHandler: IErrorHandler = new DefaultErrorHandler(this as any);

    errors: { [P in keyof T]?: string } = {};

    errorMessages: { [P in keyof T]?: IErrorMessage } = {};

    needCreate = true;

    patchFields = [];

    checkStatus = false;

    public valueChanged: boolean = false;
    protected autoSave = false;
    protected revertChangesOnError = false;

    protected abstract createForm(): FormGroup;


    get valid(): boolean {
        return this.form.valid;
    }

    get invalid(): boolean {
        return this.form.invalid;
    }

    get formValue(): Partial<T> {
        return this.form && this.form.value;
    }

    get formRawValue(): Partial<T> {
        return this.form.getRawValue();
    }

    get controls(): { [key in keyof Partial<T>]: AbstractControl } {
        return this.form && this.form.controls as { [key in keyof Partial<T>]: AbstractControl };
    }

    ngOnInit() {
        const form = this.createForm();

        form.statusChanges.subscribe(() => this._handleStatusChange(form));
        form.valueChanges.subscribe(value => this.handleValueChange(value));
        form.valueChanges.pipe(
            tap(() => !this.initializing && (this.valueChanged = true)),
            filter(() => this.canAutoSave()),
            debounceTime(400),
        ).subscribe((value) => this.handleAutoSave(value));

        this.form = form;
        super.ngOnInit();
        this._handleStatusChange(form);
    }

    ngDoCheck() {
        if (this.checkStatus && this.form && this.form.touched) {
            this._handleStatusChange(this.form);
        }
    }
    
    getRawValue(): T {
        return this.form.getRawValue();
    }

    apply(e?: Event) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }

        if (!this.valueChanged)
            return;

        this._removeExtraSpaces();

        this._validateForm();

        if (this.form.invalid) {
            if (this.revertChangesOnError) {
                this.form.setValue(this.getRawValue());
            }

            this.valueChanged = false;
            this._handleFormInvalidError(this.errors);
            return;
        }

        const obj = this.getDto();

        if (this.needCreate)
            this.create(obj);
        else {
            const diff = difference(obj, this.item);
            let [field] = Object.keys(diff);

            if (!this.patchFields.includes(field))
                field = null; // if patch disabled

            this.update(obj, field);
        }
    }

    getDto(): T {
        return {...this.item, ...this.getRawValue()};
    }

    create(obj: T) {
        const hide = this.showLoading();

        this.setProjectContext()
            .pipe(
                switchMap(() => this._create(obj).pipe(finalize(hide), finalize(this._makeUnchanged())))
            ).subscribe(
            (res) => {
                this._handleCreateItem({...obj, ...res});
                this._handleSuccessCreate(res);
            },
            error => this._handleErrorCreate(error)
        );
    }

    update(obj: T, field?: string) {
        const hide = this.showLoading();
        const request = field ? this._patch(obj, field) : this._update(obj);

        this.setProjectContext()
            .pipe(
                switchMap(() => request.pipe(finalize(hide), finalize(this._makeUnchanged())))
            ).subscribe(
            (res) => {
                this._handleUpdateItem({...obj, ...res});
                this._handleSuccessUpdate();
            },
            error => this._handleUpdateError(error)
        );
    }

    protected _removeExtraSpaces() {
        for (const key of Object.keys(this.form.value)) {
            if (typeof (this.form.value[key]) === 'string') {
                this.form.controls[key].setValue(this.form.value[key].trim(), {
                    emitEvent: false
                });
                this.valueChanged = false;
            }
        }
    }

    protected _handleFormInvalidError(errors?: any) {
    }

    protected _handleUpdateError(error: any) {
        if (this.revertChangesOnError) {
            this.setForm(this.item);
        }

        this._handleErrorUpdate(error);
    }

    protected _create(obj: T): Observable<any> {
        return this.provider.createItem(obj);
    }

    protected _update(obj: T): Observable<any> {
        return this.provider.updateItem(obj);
    }

    protected _patch(obj: Partial<T>, field: string): Observable<any> {
        return this.provider.patchItem(obj, field);
    }

    protected handleItem(item: T): void {
        super.handleItem(item);

        this.needCreate = !item || (item as any).id == null;

        if (item) {
            this.setForm(item, false);
        }

        // this.valueChanged = false;
    }

    protected setForm(item: T | any, emitEvent = true) {
        try {
            const controls = this.form.controls;

            for (const key in controls)
                if (controls.hasOwnProperty(key)) {
                    const control = controls[key];

                    if (control instanceof FormGroup) {
                        // TODO: Add handling for child formGroup
                    } else {
                        if (item[key] !== undefined && control.value !== item[key])
                            control.setValue(item[key], {emitEvent});
                    }

                }
        } catch (e) {
            console.error(e);
        }
    }

    protected _handleStatusChange(form: FormGroup) {
        const controls = form.controls;
        const errors = {};

        for (const key in controls)
            if (controls.hasOwnProperty(key)) {
                const control = controls[key];
                errors[key] = ((control.dirty || control.touched) && control.invalid) ?
                    this.errorHandler.getError(key, control.errors) : '';
            }

        this.errors = errors;
    }

    protected canAutoSave() {
        return this.autoSave && !this.initializing;
    }

    protected handleValueChange(value: any) {
    }

    protected handleAutoSave(value: any) {
        if (this.canAutoSave()) { // this should be here because of debounce
            this.apply();
        }
    }

    protected _validateForm() {
        const controls = this.form.controls;

        // update validators attached to form

        for (const key in controls)
            if (controls.hasOwnProperty(key)) {
                const control = controls[key];
                control.markAsTouched({onlySelf: true});
                control.updateValueAndValidity({onlySelf: true, emitEvent: false});
            }

        this.form.updateValueAndValidity({onlySelf: true, emitEvent: false});

        this._handleStatusChange(this.form);
    }

    protected _getError(key: string, errors: any): string {
        console.log('some key of error', key, errors);
        const errorMessages: IErrorMessage = this.errorMessages[key],
            errorKey = Object.keys(errors)[0];

        if (errorMessages && typeof errorMessages[errorKey] === 'string')
            return errorMessages[errorKey] as string;

        return 'Error';
    }

    protected _handleSuccessCreate(response?) {
        this.showSuccess('action.successfully-created');
    }

    protected _handleSuccessUpdate() {
        this.showSuccess('action.successfully-updated');
    }

    protected _handleErrorCreate(error: any) {
        this.showError(error, 'action.create-error');
    }

    protected _handleErrorUpdate(error: any) {
        this.showError(error, 'action.update-error');
    }

    protected _makeUnchanged() {
        return () => this.valueChanged = false;
    }

    protected _handleUpdateItem(item: T): boolean {
        if (!super._handleUpdateItem(item))
            return false;

        const autoSave = this.autoSave;
        this.autoSave = false;
        this.setForm(item, false);
        this.autoSave = autoSave;
        return true;
    }
}
