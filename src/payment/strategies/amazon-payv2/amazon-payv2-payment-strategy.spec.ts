import { createClient as createPaymentClient } from '@bigcommerce/bigpay-client';
import { createAction, createErrorAction } from '@bigcommerce/data-store';
import { createFormPoster, FormPoster } from '@bigcommerce/form-poster';
import { createRequestSender, RequestSender } from '@bigcommerce/request-sender';
import { createScriptLoader } from '@bigcommerce/script-loader';
import { merge, omit } from 'lodash';
import { of, Observable } from 'rxjs';

import { createCheckoutStore, CheckoutRequestSender, CheckoutStore, CheckoutValidator } from '../../../checkout';
import { getCheckoutStoreState } from '../../../checkout/checkouts.mock';
import { InvalidArgumentError, MissingDataError, RequestError } from '../../../common/error/errors';
import { getResponse } from '../../../common/http-request/responses.mock';
import { FinalizeOrderAction, OrderActionCreator, OrderActionType, OrderRequestBody, OrderRequestSender, SubmitOrderAction } from '../../../order';
import { OrderFinalizationNotRequiredError } from '../../../order/errors';
import { getIncompleteOrder, getOrderRequestBody, getSubmittedOrder } from '../../../order/internal-orders.mock';
import { getOrder } from '../../../order/orders.mock';
import { createPaymentStrategyRegistry, PaymentActionCreator, PaymentMethod, PaymentMethodActionCreator } from '../../../payment';
import { getAmazonPayv2 } from '../../../payment/payment-methods.mock';
import { AmazonPayv2PaymentProcessor } from '../../../payment/strategies/amazon-payv2';
import { getPaymentMethodMockUndefinedMerchant } from '../../../payment/strategies/amazon-payv2/amazon-payv2.mock';
import { createSpamProtection, SpamProtectionActionCreator, SpamProtectionRequestSender } from '../../../spam-protection';
import { PaymentArgumentInvalidError } from '../../errors';
import { PaymentActionType, SubmitPaymentAction } from '../../payment-actions';
import PaymentMethodRequestSender from '../../payment-method-request-sender';
import { PaymentInitializeOptions } from '../../payment-request-options';
import PaymentRequestSender from '../../payment-request-sender';
import PaymentRequestTransformer from '../../payment-request-transformer';
import * as paymentStatusTypes from '../../payment-status-types';
import PaymentStrategyActionCreator from '../../payment-strategy-action-creator';
import { PaymentStrategyActionType } from '../../payment-strategy-actions';
import { getErrorPaymentResponseBody } from '../../payments.mock';

import AmazonPayv2PaymentInitializeOptions from './amazon-payv2-payment-initialize-options';
import AmazonPayv2PaymentStrategy from './amazon-payv2-payment-strategy';
import createAmazonPayv2PaymentProcessor from './create-amazon-payv2-payment-processor';

describe('AmazonPayv2PaymentStrategy', () => {
    let amazonPayv2PaymentProcessor: AmazonPayv2PaymentProcessor;
    let container: HTMLDivElement;
    let editBillingButton: HTMLDivElement;
    let editShippingButton: HTMLDivElement;
    let finalizeOrderAction: Observable<FinalizeOrderAction>;
    let formPoster: FormPoster;
    let orderActionCreator: OrderActionCreator;
    let paymentActionCreator: PaymentActionCreator;
    let paymentMethodActionCreator: PaymentMethodActionCreator;
    let paymentMethodMock: PaymentMethod;
    let paymentStrategyActionCreator: PaymentStrategyActionCreator;
    let requestSender: RequestSender;
    let signInCustomer: jest.Mock;
    let store: CheckoutStore;
    let strategy: AmazonPayv2PaymentStrategy;
    let submitOrderAction: Observable<SubmitOrderAction>;

    beforeEach(() => {
        store = createCheckoutStore(getCheckoutStoreState());
        amazonPayv2PaymentProcessor = createAmazonPayv2PaymentProcessor(store);
        requestSender = createRequestSender();
        signInCustomer = jest.fn();
        formPoster = createFormPoster();

        const paymentClient = createPaymentClient(store);
        const spamProtection = createSpamProtection(createScriptLoader());
        const registry = createPaymentStrategyRegistry(store, paymentClient, requestSender, spamProtection, 'en_US');
        const paymentMethodRequestSender: PaymentMethodRequestSender = new PaymentMethodRequestSender(requestSender);
        const widgetInteractionAction = of(createAction(PaymentStrategyActionType.WidgetInteractionStarted));
        let submitPaymentAction: Observable<SubmitPaymentAction>;

        orderActionCreator = new OrderActionCreator(
            new OrderRequestSender(createRequestSender()),
            new CheckoutValidator(new CheckoutRequestSender(createRequestSender()))
        );

        paymentStrategyActionCreator = new PaymentStrategyActionCreator(
            registry,
            orderActionCreator,
            new SpamProtectionActionCreator(spamProtection, new SpamProtectionRequestSender(requestSender))
        );

        paymentActionCreator = new PaymentActionCreator(
            new PaymentRequestSender(createPaymentClient()),
            orderActionCreator,
            new PaymentRequestTransformer()
        );

        paymentMethodActionCreator = new PaymentMethodActionCreator(paymentMethodRequestSender);

        finalizeOrderAction = of(createAction(OrderActionType.FinalizeOrderRequested));
        submitOrderAction = of(createAction(OrderActionType.SubmitOrderRequested));
        paymentMethodMock = { ...getAmazonPayv2(), initializationData: { paymentToken: undefined } };

        container = document.createElement('div');
        container.setAttribute('id', 'container');
        document.body.appendChild(container);

        editShippingButton = document.createElement('div');
        editShippingButton.setAttribute('id', 'edit-shipping-address-button');
        document.body.appendChild(editShippingButton);

        editBillingButton = document.createElement('div');
        editBillingButton.setAttribute('id', 'edit-billing-address-button');
        document.body.appendChild(editBillingButton);
        finalizeOrderAction = of(createAction(OrderActionType.FinalizeOrderRequested));
        submitPaymentAction = of(createAction(PaymentActionType.SubmitPaymentRequested));

        jest.spyOn(store, 'dispatch');

        jest.spyOn(amazonPayv2PaymentProcessor, 'initialize')
            .mockReturnValue(Promise.resolve());

        jest.spyOn(amazonPayv2PaymentProcessor, 'deinitialize')
            .mockReturnValue(Promise.resolve());

        jest.spyOn(amazonPayv2PaymentProcessor, 'createButton')
            .mockReturnValue(container);

        jest.spyOn(amazonPayv2PaymentProcessor, 'bindButton')
            .mockImplementation(() => {});

        jest.spyOn(orderActionCreator, 'finalizeOrder')
            .mockReturnValue(finalizeOrderAction);

        jest.spyOn(orderActionCreator, 'submitOrder')
            .mockReturnValue(submitOrderAction);

        jest.spyOn(formPoster, 'postForm')
            .mockImplementation((_url, _data, callback = () => {}) => callback());

        jest.spyOn(paymentMethodActionCreator, 'loadPaymentMethod')
            .mockResolvedValue(store.getState());

        jest.spyOn(paymentStrategyActionCreator, 'widgetInteraction')
            .mockImplementation(() => widgetInteractionAction);

        jest.spyOn(store.getState().paymentMethods, 'getPaymentMethod')
            .mockReturnValue(paymentMethodMock);

        jest.spyOn(paymentActionCreator, 'submitPayment')
            .mockReturnValue(submitPaymentAction);

        strategy = new AmazonPayv2PaymentStrategy(store,
            paymentStrategyActionCreator,
            paymentMethodActionCreator,
            orderActionCreator,
            paymentActionCreator,
            amazonPayv2PaymentProcessor,
            formPoster
        );
    });

    afterEach(() => {
        document.body.removeChild(container);

        if (editShippingButton.parentElement === document.body) {
            document.body.removeChild(editShippingButton);
        } else {
            const shippingButton = document.getElementById('edit-shipping-address-button');
            if (shippingButton) {
                document.body.removeChild(shippingButton);
            }
        }

        if (editShippingButton.parentElement === document.body) {
            document.body.removeChild(editBillingButton);
        } else {
            const billingButton = document.getElementById('edit-billing-address-button');
            if (billingButton) {
                document.body.removeChild(billingButton);
            }
        }
    });

    it('creates an instance of AmazonPayv2PaymentStrategy', () => {
        expect(strategy).toBeInstanceOf(AmazonPayv2PaymentStrategy);
    });

    describe('#initialize()', () => {
        let amazonpayv2InitializeOptions: AmazonPayv2PaymentInitializeOptions;
        let initializeOptions: PaymentInitializeOptions;
        const paymentToken = 'abc123';
        const billingId = 'edit-billing-address-button';
        const shippingId = 'edit-shipping-address-button';

        beforeEach(() => {
            amazonpayv2InitializeOptions = { container: 'container', signInCustomer };
            initializeOptions = { methodId: 'amazonpay', amazonpay: amazonpayv2InitializeOptions };
        });

        it('creates the signin button if no paymentToken is present on initializationData', async () => {
            await strategy.initialize(initializeOptions);

            expect(amazonPayv2PaymentProcessor.bindButton).not.toHaveBeenCalled();
            expect(amazonPayv2PaymentProcessor.initialize).toHaveBeenCalledWith(paymentMethodMock.id);
            expect(amazonPayv2PaymentProcessor.createButton).toHaveBeenCalledWith(`#${amazonpayv2InitializeOptions.container}`, expect.any(Object));
        });

        it('fails to initialize the strategy if no PaymentMethod is supplied', async () => {
            jest.spyOn(store.getState().paymentMethods, 'getPaymentMethod').mockReturnValue(undefined);

            await expect(strategy.initialize(initializeOptions)).rejects.toThrow(MissingDataError);
        });

        it('initialize the strategy and validates if cart contains physical items', async () => {
            jest.spyOn(store.getState().cart, 'getCart')
            .mockReturnValue({...store.getState().cart.getCart(), lineItems: {physicalItems: []}});
            await strategy.initialize(initializeOptions);

            expect(amazonPayv2PaymentProcessor.createButton).toHaveBeenCalled();
        });

        it('fails to initialize the strategy if amazonpayv2InitializeOptions invalid are provided ', async () => {
            amazonpayv2InitializeOptions = { container: 'invalid_container', signInCustomer };
            initializeOptions = { methodId: 'amazonpay', amazonpay: amazonpayv2InitializeOptions };

            await expect(strategy.initialize(initializeOptions)).rejects.toThrow(InvalidArgumentError);
        });

        it('fails to initialize the strategy if no methodid is supplied', async () => {
            initializeOptions = { methodId: '', amazonpay: amazonpayv2InitializeOptions };

            await expect(strategy.initialize(initializeOptions)).rejects.toThrow(MissingDataError);
        });

        it('fails to initialize the strategy if config is not initialized', async () => {
            jest.spyOn(store.getState().config, 'getStoreConfig').mockReturnValue(undefined);

            await expect(strategy.initialize(initializeOptions)).rejects.toThrow(MissingDataError);
        });

        it('fails initialize the strategy if merchantId is not supplied', async () => {
            jest.spyOn(store.getState().paymentMethods, 'getPaymentMethod').mockReturnValue(getPaymentMethodMockUndefinedMerchant());

            await expect(strategy.initialize(initializeOptions)).rejects.toThrow(InvalidArgumentError);
        });

        it('fails to create signInButton  if get Payment method fails', async () => {
            jest.spyOn(store.getState().paymentMethods, 'getPaymentMethod').mockReturnValue(undefined);
            jest.spyOn(store.getState().paymentMethods, 'getPaymentMethod') .mockReturnValueOnce(paymentMethodMock);

            await expect(strategy.initialize(initializeOptions)).rejects.toThrow(MissingDataError);
        });

        it('binds edit buttons if paymentToken is present on initializationData', async () => {
            paymentMethodMock.initializationData.paymentToken = paymentToken;

            await strategy.initialize(initializeOptions);

            expect(amazonPayv2PaymentProcessor.createButton).not.toHaveBeenCalled();
            expect(amazonPayv2PaymentProcessor.initialize).toHaveBeenCalledWith(paymentMethodMock.id);
            expect(amazonPayv2PaymentProcessor.bindButton).toHaveBeenCalledWith(`#${shippingId}`, paymentToken);
            expect(amazonPayv2PaymentProcessor.bindButton).toHaveBeenCalledWith(`#${billingId}`, paymentToken);
        });

        it('dispatches widgetInteraction when clicking previously binded buttons', async () => {
            paymentMethodMock.initializationData.paymentToken = paymentToken;

            await strategy.initialize(initializeOptions);

            const editButton = document.getElementById(shippingId);
            if (editButton) {
                editButton.click();
            }

            expect(paymentStrategyActionCreator.widgetInteraction).toHaveBeenCalled();
        });

        it('does not initialize the paymentProcessor if no options.amazonpayv2 are provided', () => {
            initializeOptions.amazonpay = undefined;

            expect(strategy.initialize(initializeOptions)).rejects.toThrow(InvalidArgumentError);
            expect(amazonPayv2PaymentProcessor.initialize).not.toHaveBeenCalled();
        });

        it('does not initialize the paymentProcessor if no options.methodId are provided', () => {
            initializeOptions.methodId = '';

            expect(strategy.initialize(initializeOptions)).rejects.toThrow(MissingDataError);
            expect(amazonPayv2PaymentProcessor.initialize).not.toHaveBeenCalled();
        });

        it('does not initialize the paymentProcessor if payment method is missing', () => {
            jest.spyOn(store.getState().paymentMethods, 'getPaymentMethod')
                .mockReturnValue(undefined);

            expect(strategy.initialize(initializeOptions)).rejects.toThrow(MissingDataError);
            expect(amazonPayv2PaymentProcessor.initialize).not.toHaveBeenCalled();
        });

        it('does not bind edit billing address button if button do not exist', async () => {
            document.body.removeChild(editBillingButton);
            paymentMethodMock.initializationData.paymentToken = paymentToken;

            await strategy.initialize(initializeOptions);

            expect(amazonPayv2PaymentProcessor.createButton).not.toHaveBeenCalled();
            expect(amazonPayv2PaymentProcessor.initialize).toHaveBeenCalledWith(paymentMethodMock.id);
            expect(amazonPayv2PaymentProcessor.bindButton).toHaveBeenCalledWith(`#${shippingId}`, paymentToken);
            expect(amazonPayv2PaymentProcessor.bindButton).not.toHaveBeenCalledWith(`#${billingId}`, paymentToken);

            document.body.appendChild(editShippingButton);
        });
    });

    describe('#execute()', () => {
        let amazonpayv2InitializeOptions: AmazonPayv2PaymentInitializeOptions;
        let initializeOptions: PaymentInitializeOptions;
        let orderRequestBody: OrderRequestBody;
        const paymentToken = 'abc123';

        beforeEach(async () => {
            amazonpayv2InitializeOptions = { container: 'container', signInCustomer };
            initializeOptions = { methodId: 'amazonpay', amazonpay: amazonpayv2InitializeOptions };
            orderRequestBody = {
                ...getOrderRequestBody(),
                payment: {
                    methodId: 'amazonpay',
                },
            };

            await strategy.initialize(initializeOptions);
        });

        it('shows the spinner if no paymentToken is found on intializationData', async () => {
            await strategy.execute(orderRequestBody, initializeOptions);

            expect(paymentStrategyActionCreator.widgetInteraction).toHaveBeenCalled();
        });

        it('starts flow if paymentToken is found on intializationData', async () => {
            paymentMethodMock.initializationData.paymentToken = paymentToken;

            await strategy.initialize(initializeOptions);

            await strategy.execute(orderRequestBody, initializeOptions);

            expect(orderActionCreator.submitOrder).toHaveBeenCalledWith(omit(orderRequestBody, 'payment'), initializeOptions);
        });

        it('fails to execute if strategy is not initialized', () => {
            strategy = new AmazonPayv2PaymentStrategy(store,
                paymentStrategyActionCreator,
                paymentMethodActionCreator,
                orderActionCreator,
                paymentActionCreator,
                amazonPayv2PaymentProcessor,
                formPoster
            );

            expect(strategy.execute(orderRequestBody, initializeOptions)).rejects.toThrow(MissingDataError);

        });

        it('fails to execute if payment method is not found', () => {
            jest.spyOn(store.getState().paymentMethods, 'getPaymentMethod')
                .mockReturnValue(undefined);

            expect(strategy.execute(orderRequestBody, initializeOptions)).rejects.toThrow(MissingDataError);
        });

        it('fails to execute if payment argument is invalid', async () => {
            orderRequestBody.payment = undefined;
            paymentMethodMock.initializationData.paymentToken = paymentToken;

            await strategy.initialize(initializeOptions);

            expect(strategy.execute(orderRequestBody, initializeOptions)).rejects.toThrow(PaymentArgumentInvalidError);
        });

        it('redirects to Amazon url', async () => {
            const error = new RequestError(getResponse({
                ...getErrorPaymentResponseBody(),
                errors: [
                    { code: 'three_d_secure_required' },
                ],
                three_ds_result: {
                    acs_url: 'https://acs/url',
                    callback_url: 'https://callback/url',
                    payer_auth_request: 'payer_auth_request',
                    merchant_data: 'merchant_data',
                },
                status: 'error',
            }));

            jest.spyOn(paymentActionCreator, 'submitPayment')
                .mockReturnValue(of(createErrorAction(PaymentActionType.SubmitPaymentFailed, error)));

            paymentMethodMock.initializationData.paymentToken = paymentToken;

            await strategy.initialize(initializeOptions);
            strategy.execute(orderRequestBody, initializeOptions);

            await new Promise(resolve => process.nextTick(resolve));

            expect(formPoster.postForm).toHaveBeenCalledWith('https://acs/url', {});
        });

        it('does not redirect to Amazon url', async () => {
            const response = new RequestError(getResponse(getErrorPaymentResponseBody()));

            jest.spyOn(paymentActionCreator, 'submitPayment')
                .mockReturnValue(of(createErrorAction(PaymentActionType.SubmitPaymentFailed, response)));

            paymentMethodMock.initializationData.paymentToken = paymentToken;

            await strategy.initialize(initializeOptions);
            strategy.execute(orderRequestBody, initializeOptions);

            expect(formPoster.postForm).not.toHaveBeenCalled();
        });
    });

    describe('#finalize()', () => {
        const options = { methodId: 'amazonpay' };

        it('finalizes order if order is created and payment is acknowledged', async () => {
            const state = store.getState();

            jest.spyOn(state.order, 'getOrder')
                .mockReturnValue(getOrder());

            jest.spyOn(state.payment, 'getPaymentStatus')
                .mockReturnValue(paymentStatusTypes.ACKNOWLEDGE);

            await strategy.finalize(options);

            expect(orderActionCreator.finalizeOrder).toHaveBeenCalledWith(getOrder().orderId, options);
            expect(store.dispatch).toHaveBeenCalledWith(finalizeOrderAction);
        });

        it('finalizes order if order is created and payment is finalized', async () => {
            const state = store.getState();

            jest.spyOn(state.order, 'getOrder')
                .mockReturnValue(getOrder());

            jest.spyOn(state.payment, 'getPaymentStatus')
                .mockReturnValue(paymentStatusTypes.FINALIZE);

            await strategy.finalize(options);

            expect(orderActionCreator.finalizeOrder).toHaveBeenCalledWith(getOrder().orderId, options);
            expect(store.dispatch).toHaveBeenCalledWith(finalizeOrderAction);
        });

        it('does not finalize order if order is not created', () => {
            const state = store.getState();

            jest.spyOn(state.order, 'getOrder').mockReturnValue(getIncompleteOrder());

            expect(strategy.finalize()).rejects.toThrow(OrderFinalizationNotRequiredError);
            expect(orderActionCreator.finalizeOrder).not.toHaveBeenCalled();
            expect(store.dispatch).not.toHaveBeenCalledWith(finalizeOrderAction);
        });

        it('does not finalize order if order is not finalized or acknowledged', () => {
            const state = store.getState();

            jest.spyOn(state.order, 'getOrder').mockReturnValue(merge({}, getSubmittedOrder(), {
                payment: {
                    status: paymentStatusTypes.INITIALIZE,
                },
            }));

            expect(strategy.finalize()).rejects.toThrow(OrderFinalizationNotRequiredError);
            expect(orderActionCreator.finalizeOrder).not.toHaveBeenCalled();
            expect(store.dispatch).not.toHaveBeenCalledWith(finalizeOrderAction);
        });

        it('throws error if unable to finalize due to missing data', () => {
            const state = store.getState();

            jest.spyOn(state.order, 'getOrder')
                .mockReturnValue(null);

            expect(strategy.finalize()).rejects.toThrow(OrderFinalizationNotRequiredError);
        });
    });

    describe('#deinitialize()', () => {
        let amazonpayv2InitializeOptions: AmazonPayv2PaymentInitializeOptions;
        let initializeOptions: PaymentInitializeOptions;

        beforeEach(async () => {
            amazonpayv2InitializeOptions = { container: 'container', signInCustomer };
            initializeOptions = { methodId: 'amazonpay', amazonpay: amazonpayv2InitializeOptions };
            await strategy.initialize(initializeOptions);
        });

        it('expect to deinitialize the payment processor', async () => {
            await strategy.deinitialize(initializeOptions);

            expect(amazonPayv2PaymentProcessor.deinitialize).toHaveBeenCalled();

            // prevent object not found failure
            document.body.appendChild(container);
        });

        it('deinitializes strategy', async () => {
            await strategy.deinitialize();

            expect(await strategy.deinitialize()).toEqual(store.getState());

            // prevent object not found failure
            document.body.appendChild(container);
        });
    });
});
