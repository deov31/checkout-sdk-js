import { noop } from 'lodash';

import { CheckoutStore, InternalCheckoutSelectors } from '../../../checkout';
import { InvalidArgumentError, MissingDataError, MissingDataErrorType } from '../../../common/error/errors';
import { PaymentMethod, PaymentMethodActionCreator } from '../../../payment';
import { AmazonPayv2PaymentProcessor } from '../../../payment/strategies/amazon-payv2';
import { ShippingInitializeOptions } from '../../shipping-request-options';
import ShippingStrategy from '../shipping-strategy';

export default class AmazonPayv2ShippingStrategy implements ShippingStrategy {
    private _paymentMethod?: PaymentMethod;

    constructor(
        private _store: CheckoutStore,
        private _paymentMethodActionCreator: PaymentMethodActionCreator,
        private _amazonPayv2PaymentProcessor: AmazonPayv2PaymentProcessor,
    ) {}

    initialize(options: ShippingInitializeOptions): Promise<InternalCheckoutSelectors> {
        const { methodId } = options;
        console.log("inside initialize");

        if (!methodId) {
            throw new InvalidArgumentError('Unable to proceed because "options.amazonv2" argument is not provided.');
        }     

        return this._store.dispatch(this._paymentMethodActionCreator.loadPaymentMethod(methodId))
            .then(state => new Promise(() => {
                this._paymentMethod = state.paymentMethods.getPaymentMethod(methodId);

                if (!this._paymentMethod) {
                    throw new MissingDataError(MissingDataErrorType.MissingPaymentMethod);
                }

                const { paymentToken } = this._paymentMethod.initializationData;

                if (paymentToken) {
                    this._bindEditButton('meow', paymentToken);
                }
            }))
            .then(() => this._store.getState());
    }

    deinitialize(): Promise<InternalCheckoutSelectors> {
        //this._paymentMethod = undefined;

        return Promise.resolve(this._store.getState());
    }

    private _bindEditButton(type: string, sessionId: string): void {
        const id = `#edit-${type}-address-button`;
        const button = document.querySelector(id);

        if (!button) {
            return;
        }

        const clone = button.cloneNode(true);
        button.replaceWith(clone);

        //clone.addEventListener('click', () => this._showLoadingSpinner(() => new Promise(noop)));
        clone.addEventListener('click', () => new Promise(noop));

        this._amazonPayv2PaymentProcessor.bindButton(id, sessionId);
    }

    // private _showLoadingSpinner(callback?: () => Promise<void> | Promise<never>): Promise<InternalCheckoutSelectors> {
    //     // return this._store.dispatch(this._paymentStrategyActionCreator.widgetInteraction(() => {

    //     //     if (callback) {
    //     //         return callback();
    //     //     }

    //     //     return Promise.reject();
    //     // }), { queueId: 'widgetInteraction' });
    //     return Promise.resolve(this._store.getState());
    // }

    updateAddress(): Promise<InternalCheckoutSelectors> {
        return Promise.resolve(this._store.getState());
    }

    selectOption(): Promise<InternalCheckoutSelectors> {
        return Promise.resolve(this._store.getState());
    }
}
