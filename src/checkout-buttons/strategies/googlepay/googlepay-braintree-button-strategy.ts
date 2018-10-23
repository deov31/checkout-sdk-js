import { FormPoster } from '@bigcommerce/form-poster';

import { Checkout, CheckoutActionCreator, CheckoutStore } from '../../../checkout';
import { InvalidArgumentError, MissingDataError, MissingDataErrorType } from '../../../common/error/errors';
import { bindDecorator as bind } from '../../../common/utility';
import { PaymentMethodActionCreator } from '../../../payment';
import { GooglePayAddress, GooglePayPaymentProcessor } from '../../../payment/strategies/googlepay';
import { CheckoutButtonInitializeOptions, CheckoutButtonOptions } from '../../checkout-button-options';
import CheckoutButtonStrategy from '../checkout-button-strategy';

export default class GooglePayBraintreeButtonStrategy extends CheckoutButtonStrategy {
    private _methodId?: string;
    private _checkout?: Checkout;
    private _walletButton?: HTMLElement;

    constructor(
        private _store: CheckoutStore,
        private _formPoster: FormPoster,
        private _checkoutActionCreator: CheckoutActionCreator,
        private _paymentMethodActionCreator: PaymentMethodActionCreator,
        private _googlePayPaymentProcessor: GooglePayPaymentProcessor
    ) {
        super();
    }

    initialize(options: CheckoutButtonInitializeOptions): Promise<void> {
        if (this._isInitialized) {
            return super.initialize(options);
        }

        const { googlepaybraintree, methodId } = options;

        this._methodId = methodId;

        if (!googlepaybraintree) {
            throw new MissingDataError(MissingDataErrorType.MissingPaymentMethod);
        }

        return this._store.dispatch(this._checkoutActionCreator.loadDefaultCheckout())
            .then(stateCheckout => {
                this._checkout = stateCheckout.checkout.getCheckout();
                if (!this._checkout || !this._checkout.cart.id) {
                    throw new MissingDataError(MissingDataErrorType.MissingCart);
                }

                return this._googlePayPaymentProcessor.initialize(this._getMethodId())
                    .then(() => {
                        this._walletButton = this._createSignInButton(googlepaybraintree.container);

                        if (this._walletButton) {
                            this._walletButton.addEventListener('click', this._handleWalletButtonClick);
                        }
                    });
            }).then(() => super.initialize(options));
    }

    deinitialize(options: CheckoutButtonOptions): Promise<void> {
        if (!this._isInitialized) {
            return super.deinitialize(options);
        }

        if (this._walletButton && this._walletButton.parentNode) {
            this._walletButton.parentNode.removeChild(this._walletButton);
            this._walletButton.removeEventListener('click', this._handleWalletButtonClick);
            this._walletButton = undefined;
        }

        return this._googlePayPaymentProcessor.deinitialize()
            .then(() => super.deinitialize(options));
    }

    private _createSignInButton(containerId: string): HTMLElement {
        const container = document.querySelector(`#${containerId}`);

        if (!container) {
            throw new InvalidArgumentError('Unable to create sign-in button without valid container ID.');
        }

        const googlePayButton = this._googlePayPaymentProcessor.createButton(() => this._onPaymentSelectComplete);

        container.appendChild(googlePayButton);

        return googlePayButton;
    }

    private _getMethodId(): string {
        if (!this._methodId) {
            throw new MissingDataError(MissingDataErrorType.MissingPaymentMethod);
        }

        return this._methodId;
    }

    @bind
    private _handleWalletButtonClick(event: Event): Promise<void> {
        event.preventDefault();

        let shippingAddress: GooglePayAddress;

        return this._googlePayPaymentProcessor.displayWallet()
            .then(paymentData => {
                shippingAddress = paymentData.shippingAddress;
                return this._googlePayPaymentProcessor.handleSuccess(paymentData);
            })
            .then(() => this._updateAddressAndPayment(shippingAddress))
            .catch(error => this._onError(error));
    }

    private _onPaymentSelectComplete(): void {
        this._formPoster.postForm('/checkout.php', {
            headers: {
                Accept: 'text/html',
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });
    }

    private _onError(error?: Error): void {
        if (error && error.message !== 'CANCELED') {
            throw new Error(error.message);
        }
    }

    private _updateAddressAndPayment(shippingAddress: GooglePayAddress): Promise<void> {
        return Promise.all([
            this._googlePayPaymentProcessor.updateShippingAddress(shippingAddress),
            this._store.dispatch(this._checkoutActionCreator.loadCurrentCheckout()),
            this._store.dispatch(this._paymentMethodActionCreator.loadPaymentMethod(this._getMethodId())),
        ]).then(() => this._onPaymentSelectComplete());
    }

}
