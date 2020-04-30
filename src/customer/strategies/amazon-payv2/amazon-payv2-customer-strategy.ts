import { FormPoster } from '@bigcommerce/form-poster';
import { noop } from 'lodash';

import { CheckoutStore, InternalCheckoutSelectors } from '../../../checkout';
import { InvalidArgumentError, MissingDataError, MissingDataErrorType, NotImplementedError } from '../../../common/error/errors';
import { AmazonPayv2PaymentProcessor, AmazonPayv2PayOptions, AmazonPayv2Placement } from '../../../payment/strategies/amazon-payv2';
import { RemoteCheckoutActionCreator } from '../../../remote-checkout';
import { CustomerInitializeOptions, CustomerRequestOptions } from '../../customer-request-options';
import CustomerStrategyActionCreator from '../../customer-strategy-action-creator';
import CustomerStrategy from '../customer-strategy';


export default class AmazonPayv2CustomerStrategy implements CustomerStrategy {
    private _walletButton?: HTMLElement;

    constructor(
        private _store: CheckoutStore,
        private _remoteCheckoutActionCreator: RemoteCheckoutActionCreator,
        private _amazonPayv2PaymentProcessor: AmazonPayv2PaymentProcessor,
        private _customerStrategyActionCreator: CustomerStrategyActionCreator,
        private _formPoster: FormPoster,
    ) {}

    async initialize(options: CustomerInitializeOptions): Promise<InternalCheckoutSelectors> {
        const { methodId, amazonpay } = options;

        if (!amazonpay) {
            throw new InvalidArgumentError('Unable to proceed because "options.amazonpay" argument is not provided.');
        }
        if (!methodId) {
            throw new MissingDataError(MissingDataErrorType.MissingPaymentMethod);
        }
        await this._amazonPayv2PaymentProcessor.initialize(methodId);
        this._walletButton = this._createSignInButton(amazonpay.container, methodId);

        return this._store.getState();
    }

    deinitialize(): Promise<InternalCheckoutSelectors> {
        if (this._walletButton && this._walletButton.parentNode) {
            this._walletButton.parentNode.removeChild(this._walletButton);
            this._walletButton = undefined;
        }

        return Promise.resolve(this._store.getState());
    }

    signIn(): Promise<InternalCheckoutSelectors> {
        throw new NotImplementedError(
            'In order to sign in via Amazon, the shopper must click on "Amazon Pay" button.'
        );
    }

    async signOut(options?: CustomerRequestOptions): Promise<InternalCheckoutSelectors> {
        const state = this._store.getState();
        const payment = state.payment.getPaymentId();

        if (!payment) {
            return Promise.resolve(this._store.getState());
        }

        await this._amazonPayv2PaymentProcessor.signout(payment.providerId);
        await this._store.dispatch(this._remoteCheckoutActionCreator.signOut(payment.providerId, options));

        this._reloadPage();

        return this._store.getState();
    }

    private _reloadPage(): Promise<InternalCheckoutSelectors> {
        return this._store.dispatch(this._customerStrategyActionCreator.widgetInteraction(() => {
            return this._postForm();
        }), { queueId: 'widgetInteraction' });
    }

    private _postForm(): Promise<never> {
        this._formPoster.postForm('/checkout.php', {
            headers: {
                Accept: 'text/html',
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });

        return new Promise(noop);
    }

    private _createSignInButton(containerId: string, methodId: string): HTMLElement {
        const container = document.querySelector(`#${containerId}`);

        if (!container) {
            throw new InvalidArgumentError('Unable to create sign-in button without valid container ID.');
        }

        const state = this._store.getState();
        const paymentMethod = state.paymentMethods.getPaymentMethod(methodId);
        const config = state.config.getStoreConfig();
        const cart =  state.cart.getCart();
        let productType = AmazonPayv2PayOptions.PayAndShip;
        if (!config) {
            throw new MissingDataError(MissingDataErrorType.MissingCheckoutConfig);
        }

        if (!paymentMethod) {
            throw new MissingDataError(MissingDataErrorType.MissingPaymentMethod);
        }

        if (cart && !cart.lineItems.physicalItems.length) {
            productType = AmazonPayv2PayOptions.PayOnly;
        }

        const {
            config: {
                merchantId,
                testMode,
            },
            initializationData: {
                checkoutLanguage,
                ledgerCurrency,
                checkoutSessionMethod,
                region,
                extractAmazonCheckoutSessionId,
            },
        } = paymentMethod;

        if (!merchantId) {
            throw new InvalidArgumentError('Unable to create sign-in button without valid merchant ID.');
        }

        const amazonButtonOptions = {
            merchantId,
            sandbox: !!testMode,
            checkoutLanguage,
            ledgerCurrency,
            region,
            productType,
            createCheckoutSession: {
                method: checkoutSessionMethod,
                url: `${config.storeProfile.shopPath}/remote-checkout/${methodId}/payment-session`,
                extractAmazonCheckoutSessionId,
            },
            placement: AmazonPayv2Placement.Checkout,
        };

        return this._amazonPayv2PaymentProcessor.createButton(`#${containerId}`, amazonButtonOptions);
    }
}
