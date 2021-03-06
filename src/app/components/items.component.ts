import {OnDestroy, OnInit} from '@angular/core';
import {Observable} from 'rxjs';
import {finalize, first, switchMap} from 'rxjs/operators';
import {LoadingComponent} from './loading.component';
import {IIdObject} from 'communication';
import {IPaginationParams, PaginationResponse} from '../../../projects/communication/src/lib/models/pagination';

export type ResponseHandling = 'append' | 'prepend' | null;

function toArray(obj: IIdObject | IIdObject[]) {
    return Array.isArray(obj) ? obj : [obj];
}

export const CollectionResponseHandlingMap = new Map<ResponseHandling, (response: IIdObject | IIdObject[], container: any[]) => any[]>([
    ['append', (response, container) => [...container, ...toArray(response)]],
    ['prepend', (response, container) => [...toArray(response), ...container]],
    [null, (response, container) => container = toArray(response)],
]);

export abstract class ItemsComponent<T extends IIdObject, P extends IPaginationParams | any = any>
    extends LoadingComponent<P, T> implements OnInit, OnDestroy {
    public items: T[] = [];
    public allItemsLoaded = false;

    protected queryParams: P = <P>{};
    protected _params: P;

    private _totalItems: number;
    protected _responseHandling: ResponseHandling;
    protected setPaginationQueryParams = true;

    protected set responseHandling(value: ResponseHandling) {
        this._responseHandling = value;
    }

    protected get responseHandling() {
        return this._responseHandling || null;
    }

    protected get responseHandler() {
        return CollectionResponseHandlingMap.get(this.responseHandling);
    }

    get params(): P {
        return this._params;
    }

    set params(value) {
        this._params = value;
    }

    get skip() {
        const {skip = 0} = objOrDefault(this._params);
        return skip;
    }

    set skip(value: number) {
        (this._params || <P>{}).skip = value;
    }

    set totalItems(value: number) {
        const totalItems = +value;

        if (!isNaN(totalItems) && this._totalItems !== totalItems) {
            this._totalItems = totalItems;

            if (this.setPaginationQueryParams) {
                this.setQueryParams({totalItems} as IPaginationParams);
            }
        }
    }

    get totalItems(): number {
        return this._totalItems;
    }

    getParams(params?: any): P {
        return params;
    }

    loadData(params?: P) {

        this._params = params;

        const hide = this.showLoading(true);
        const loadingParams = this.getParams(params);

        this.getPermissions()
            .pipe(
                switchMap(() => this._getItems(loadingParams).pipe(first(), finalize(hide))))
            .subscribe(
                (response) => this._handleResponse(response),
                (error) => this._handleLoadingError(error),
            );
    }

    protected _getItems(params?): Observable<T[]> {
        return this.provider.getItems(params);
    }

    refresh() {
        this.loadData(this._params);
    }

    protected _onQueryParamsChanged(params?: IPaginationParams<string>) {
        this.totalItems = +(<IPaginationParams>(params || {})).totalItems;

        if (!this.isPaginationQueryParamsChanged(this._queryParams, params) && this.setPaginationQueryParams) {
            this.setQueryParams({skip: 0} as IPaginationParams);
        }

        super._onQueryParamsChanged(params);
    }

    protected _handleUpdateItem(items: T | T[]) {
        try {
            if (!items)
                return;

            if (Array.isArray(items)) {
                for (const item of items)
                    this._handleUpdateItem(item);

                return;
            }

            const index = this.items.findIndex(t => t.id === items.id);

            if (index !== -1) {
                this.items.splice(index, 1, {...this.items[index], ...items});
            }
        } catch (e) {
            console.error('error', e);
        }
    }

    protected _getResponseHandler(responseHandling: ResponseHandling) {
        return responseHandling ? CollectionResponseHandlingMap.get(responseHandling) : null;
    }

    protected _handleCreateItem(item: T | T[], responseHandling: ResponseHandling = 'prepend') {
        try {
            if (!item)
                return;
            if (Array.isArray(item)) {
                for (const i of item) {
                    this._handleCreateItem(i);
                }
            } else if (!this.items.find(({id}) => id === item.id)) {
                const responseHandler = this._getResponseHandler(responseHandling);
                this.items = responseHandler(item, this.items);

                if (this.loadDataOnQueryParamsChange) {
                    this.totalItems = this.totalItems + 1;
                }
            }
        } catch (e) {
            console.error('error', e);
        }
    }

    protected _handleDeleteItem(items: IIdObject | IIdObject[]) {
        if (!items)
            return;

        if (Array.isArray(items)) {
            for (const item of items)
                this._handleDeleteItem(item);

            return;
        }

        const _id = typeof items === 'object' ? items.id : items;

        try {
            const index = this.items.findIndex(t => t.id === _id);

            if (index !== -1) {
                this.items.splice(index, 1);
            }
        } catch (e) {
            console.error('error', e);
        }

        if (this.loadDataOnQueryParamsChange) {
            const deletedItems = Array.isArray(items) ? items.length : 1;
            this.totalItems = this.totalItems - deletedItems;
        }
    }

    protected _handleResponse(response: T[]) {
        if (Array.isArray(response)) {
            if (response instanceof PaginationResponse) {
                this.totalItems = response.totalItems;
            }

            const {take} = <IPaginationParams>(this._params || {});
            this.items = this.responseHandler(response, this.items);

            if (take != null && response.length < take) {
                this.allItemsLoaded = true;
            }
        } else {
            throw new Error('Invalid response');
        }
    }

    protected _handleLoadingError(error: any) {
        this.showError(error, 'action.load-items-error');
    }

    protected isQueryParamsChanged(oldParams, params): boolean {
        const {totalItems: prevTotalItems = null, ...prev} = oldParams || {};
        const {totalItems, ...curr} = params;

        return super.isQueryParamsChanged(prev, curr);
    }

    protected isPaginationQueryParamsChanged(oldParams = <IPaginationParams<string>>{},
                                             params = <IPaginationParams<string>>{}) {
        return (oldParams.skip !== params.skip) || (oldParams.take !== params.take);
    }

    protected setQueryParams(params: any): void {
        this.router.navigate([], {
            queryParams: params,
            queryParamsHandling: 'merge',
            replaceUrl: true,
        });
    }
}

export function objOrDefault<T>(obj: any, defaultValue = {}): T {
    if (obj != null) {
        return obj;
    }

    return <T>defaultValue;
}
