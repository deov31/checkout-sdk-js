import { CheckoutStore } from '../../../checkout';
import { MissingDataError, MissingDataErrorType, NotInitializedError, NotInitializedErrorType } from '../../../common/error/errors';
import PaymentMethodActionCreator from '../../payment-method-action-creator';

import { AmazonMaxoButtonParams, AmazonMaxoSDK } from './amazon-maxo';
import AmazonMaxoScriptLoader from './amazon-maxo-script-loader';

export default class AmazonMaxoPaymentProcessor {
    private _amazonMaxoSDK?: AmazonMaxoSDK;
    private _methodId?: string;

    constructor(
        private _store: CheckoutStore,
        private _paymentMethodActionCreator: PaymentMethodActionCreator,
        private _amazonMaxoScriptLoader: AmazonMaxoScriptLoader
    ) { }

    initialize(methodId: string): Promise<void> {
        this._methodId = methodId;

        return this._configureWallet();
    }

    deinitialize(): Promise<void> {
        this._amazonMaxoSDK = undefined;

        return Promise.resolve();
    }

    bindButton(buttonId: string, sessionId: string): void {
        if (!this._amazonMaxoSDK) {
            throw new NotInitializedError(NotInitializedErrorType.PaymentNotInitialized);
        }

        this._amazonMaxoSDK.Pay.bindChangeAction(buttonId, {
            amazonCheckoutSessionId: sessionId,
            changeAction: 'changeAddress',
          });
    }

    createButton(containerId: string, params: AmazonMaxoButtonParams): HTMLElement {
        if (!this._amazonMaxoSDK) {
            throw new NotInitializedError(NotInitializedErrorType.PaymentNotInitialized);
        }

        return this._amazonMaxoSDK.Pay.renderButton(containerId, params);
    }

    signout(methodId: string): Promise<void> {
        this._methodId = methodId;

        if (!this._amazonMaxoSDK) {
            this._configureWallet()
            .then(() => {
                return this.signout(methodId);
            });
        } else {
            this._amazonMaxoSDK.Pay.signout();
        }

        return Promise.resolve();
    }

    private async _configureWallet(): Promise<void> {
        const methodId = this._getMethodId();
        const state = await this._store.dispatch(this._paymentMethodActionCreator.loadPaymentMethod(methodId));
        const paymentMethod = state.paymentMethods.getPaymentMethod(methodId);

        if (!paymentMethod) {
            throw new MissingDataError(MissingDataErrorType.MissingPaymentMethod);
        }

        const amazonMaxoClient = await this._amazonMaxoScriptLoader.load(paymentMethod);
        this._amazonMaxoSDK = amazonMaxoClient;
    }

    private _getMethodId(): string {
        if (!this._methodId) {
            throw new NotInitializedError(NotInitializedErrorType.PaymentNotInitialized);
        }

        return this._methodId;
    }
}
