import { createFormPoster, FormPoster } from '@bigcommerce/form-poster';
import { createRequestSender, RequestSender } from '@bigcommerce/request-sender';
import { createScriptLoader } from '@bigcommerce/script-loader';

import { GooglePayBraintreeButtonStrategy } from '../';
import { getCartState } from '../../../cart/carts.mock';
import { createCheckoutStore, CheckoutActionCreator, CheckoutRequestSender, CheckoutStore } from '../../../checkout';
import { getCheckoutState } from '../../../checkout/checkouts.mock';
import { InvalidArgumentError, MissingDataError } from '../../../common/error/errors';
import { ConfigActionCreator, ConfigRequestSender } from '../../../config';
import { getConfigState } from '../../../config/configs.mock';
import { getCustomerState } from '../../../customer/customers.mock';
import { PaymentMethod, PaymentMethodActionCreator, PaymentMethodRequestSender } from '../../../payment';
import { getPaymentMethodsState } from '../../../payment/payment-methods.mock';
import { createGooglePayPaymentProcessor, GooglePaymentData, GooglePayPaymentProcessor } from '../../../payment/strategies/googlepay';
import { getGooglePaymentDataMock } from '../../../payment/strategies/googlepay/googlepay.mock';
import { CheckoutButtonInitializeOptions } from '../../checkout-button-options';

import { getCheckoutButtonOptions, getPaymentMethod, Mode } from './googlepay-braintree-button.mock';

describe('GooglePayBraintreeCheckoutButtonStrategy', () => {
    let container: HTMLDivElement;
    let formPoster: FormPoster;
    let checkoutButtonOptions: CheckoutButtonInitializeOptions;
    let paymentMethod: PaymentMethod;
    let paymentMethodActionCreator: PaymentMethodActionCreator;
    let paymentProcessor: GooglePayPaymentProcessor;
    let checkoutActionCreator: CheckoutActionCreator;
    let requestSender: RequestSender;
    let store: CheckoutStore;
    let strategy: GooglePayBraintreeButtonStrategy;
    let walletButton: HTMLAnchorElement;

    beforeEach(() => {
        paymentMethod = getPaymentMethod();

        store = createCheckoutStore({
            checkout: getCheckoutState(),
            customer: getCustomerState(),
            config: getConfigState(),
            cart: getCartState(),
            paymentMethods: getPaymentMethodsState(),
        });

        requestSender = createRequestSender();
        paymentMethodActionCreator = new PaymentMethodActionCreator(
            new PaymentMethodRequestSender(requestSender)
        );

        checkoutActionCreator = checkoutActionCreator = new CheckoutActionCreator(
            new CheckoutRequestSender(requestSender),
            new ConfigActionCreator(new ConfigRequestSender(requestSender))
        );

        paymentProcessor = createGooglePayPaymentProcessor(store, createScriptLoader());

        formPoster = createFormPoster();

        strategy = new GooglePayBraintreeButtonStrategy(
            store,
            formPoster,
            checkoutActionCreator,
            paymentMethodActionCreator,
            paymentProcessor
        );

        jest.spyOn(store, 'dispatch')
            .mockReturnValue(Promise.resolve(store.getState()));

        jest.spyOn(paymentProcessor, 'initialize')
            .mockReturnValue(Promise.resolve());

        jest.spyOn(store.getState().paymentMethods, 'getPaymentMethod')
            .mockReturnValue(paymentMethod);

        jest.spyOn(formPoster, 'postForm')
            .mockReturnValue(Promise.resolve());

        container = document.createElement('div');
        container.setAttribute('id', 'googlePayCheckoutButton');
        walletButton = document.createElement('a');
        walletButton.setAttribute('id', 'mockButton');

        jest.spyOn(paymentProcessor, 'createButton')
            .mockReturnValue(walletButton);

        jest.spyOn(walletButton, 'addEventListener');

        jest.spyOn(walletButton, 'removeEventListener');

        jest.spyOn(paymentProcessor, 'deinitialize');

        container.appendChild(walletButton);
        document.body.appendChild(container);
    });

    afterEach(() => {
        document.body.removeChild(container);
    });

    it('creates an instance of GooglePayBraintreeButtonStrategy', () => {
        expect(strategy).toBeInstanceOf(GooglePayBraintreeButtonStrategy);
    });

    describe('#initialize()', () => {

        describe('Payment method exist', () => {

            it('adds the event listener to the wallet button', async () => {
                checkoutButtonOptions = getCheckoutButtonOptions();

                await strategy.initialize(checkoutButtonOptions);

                expect(walletButton.addEventListener).toHaveBeenCalled();
            });

            it('Validates if strategy is been initialized', async () => {
                checkoutButtonOptions = getCheckoutButtonOptions();

                await strategy.initialize(checkoutButtonOptions);

                setTimeout(() => {
                    strategy.initialize(checkoutButtonOptions);
                }, 0);

                strategy.initialize(checkoutButtonOptions);

                expect(paymentProcessor.initialize).toHaveBeenCalledTimes(1);
            });

            it('fails to initialize the strategy if no CheckoutButtonInitializeOptions is provided ', async () => {
                checkoutButtonOptions = getCheckoutButtonOptions(Mode.Incomplete);

                try {
                    await strategy.initialize(checkoutButtonOptions);
                } catch (e) {
                    expect(e).toBeInstanceOf(MissingDataError);
                }
            });

            it('fails to set methodId if is not provided ', async () => {
                checkoutButtonOptions = getCheckoutButtonOptions(Mode.UndefinedMethodId);

                try {
                    await strategy.initialize(checkoutButtonOptions);
                } catch (e) {
                    expect(e).toBeInstanceOf(MissingDataError);
                }
            });

            it('fails to initialize the strategy if no container id is supplied', async () => {
                checkoutButtonOptions = getCheckoutButtonOptions(Mode.UndefinedMethodId);

                try {
                    await strategy.initialize(checkoutButtonOptions);
                } catch (e) {
                    expect(e).toBeInstanceOf(MissingDataError);
                }
            });

            it('fails to initialize the strategy if no valid container id is supplied', async () => {
                checkoutButtonOptions = getCheckoutButtonOptions(Mode.InvalidContainer);

                try {
                    await strategy.initialize(checkoutButtonOptions);
                } catch (e) {
                    expect(e).toBeInstanceOf(InvalidArgumentError);
                }
            });
        });
    });

    describe('#deinitialize()', () => {
        let checkoutButtonOptions: CheckoutButtonInitializeOptions;

        beforeEach(() => {
            checkoutButtonOptions = getCheckoutButtonOptions();
        });

        it('check if googlepay payment processor deinitialize is called', async () => {
            await strategy.initialize(checkoutButtonOptions);

            strategy.deinitialize(checkoutButtonOptions);

            expect(paymentProcessor.deinitialize).toBeCalled();
        });

        it('succesfully deinitializes the strategy', async () => {
            await strategy.initialize(checkoutButtonOptions);

            strategy.deinitialize(checkoutButtonOptions);

            if (checkoutButtonOptions.googlepaybraintree) {
                const button = document.getElementById(checkoutButtonOptions.googlepaybraintree.container);

                if (button) {
                    expect(button.firstChild).toBe(null);
                }
            }

            container = document.createElement('div');
            document.body.appendChild(container);
        });

        it('Validates if strategy is loaded before call deinitialize', async () => {
            await strategy.deinitialize(checkoutButtonOptions);

            if (checkoutButtonOptions.googlepaybraintree) {
                const button = document.getElementById(checkoutButtonOptions.googlepaybraintree.container);

                if (button) {
                    expect(button.firstChild).toBe(null);
                }
            }

            container = document.createElement('div');
            document.body.appendChild(container);
        });
    });

    describe('#handleWalletButtonClick', () => {
        let googlePayOptions: CheckoutButtonInitializeOptions;
        let paymentData: GooglePaymentData;

        beforeEach(() => {
            googlePayOptions = {
                methodId: 'googlepay',
                googlepaybraintree: {
                    container: 'googlePayCheckoutButton',
                },
            };

            paymentData = getGooglePaymentDataMock();
        });

        it('handles wallet button event', async () => {
            spyOn(paymentProcessor, 'displayWallet').and.returnValue(Promise.resolve(paymentData));
            spyOn(paymentProcessor, 'handleSuccess').and.returnValue(Promise.resolve());
            spyOn(paymentProcessor, 'updateShippingAddress').and.returnValue(Promise.resolve());

            await strategy.initialize(googlePayOptions).then(() => {
                walletButton.click();
            });

            expect(paymentProcessor.initialize).toHaveBeenCalled();
        });
    });
});
