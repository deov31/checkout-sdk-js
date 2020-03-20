import { createClient as createPaymentClient } from '@bigcommerce/bigpay-client';
import { createAction } from '@bigcommerce/data-store';
import { createRequestSender, RequestSender } from '@bigcommerce/request-sender';
import { createScriptLoader } from '@bigcommerce/script-loader';
import { merge, omit } from 'lodash';
import { of, Observable } from 'rxjs';

import { createCheckoutStore, CheckoutRequestSender, CheckoutStore, CheckoutValidator } from '../../../checkout';
import { getCheckoutStoreState } from '../../../checkout/checkouts.mock';
import { InvalidArgumentError, MissingDataError } from '../../../common/error/errors';
import { FinalizeOrderAction, OrderActionCreator, OrderActionType, OrderRequestBody, OrderRequestSender, SubmitOrderAction } from '../../../order';
import { OrderFinalizationNotRequiredError } from '../../../order/errors';
import { getIncompleteOrder, getOrderRequestBody, getSubmittedOrder } from '../../../order/internal-orders.mock';
import { getOrder } from '../../../order/orders.mock';
import { createPaymentStrategyRegistry, PaymentActionCreator, PaymentMethod, PaymentMethodActionCreator } from '../../../payment';
import { getAmazonMaxo } from '../../../payment/payment-methods.mock';
import { AmazonMaxoPaymentProcessor } from '../../../payment/strategies/amazon-maxo';
import { createSpamProtection, SpamProtectionActionCreator, SpamProtectionRequestSender } from '../../../spam-protection';
import { PaymentArgumentInvalidError } from '../../errors';
import { InitializeOffsitePaymentAction, PaymentActionType } from '../../payment-actions';
import PaymentMethodRequestSender from '../../payment-method-request-sender';
import { PaymentInitializeOptions } from '../../payment-request-options';
import PaymentRequestSender from '../../payment-request-sender';
import PaymentRequestTransformer from '../../payment-request-transformer';
import * as paymentStatusTypes from '../../payment-status-types';
import PaymentStrategyActionCreator from '../../payment-strategy-action-creator';

import AmazonMaxoPaymentInitializeOptions from './amazon-maxo-payment-initialize-options';
import AmazonMaxoPaymentStrategy from './amazon-maxo-payment-strategy';
import createAmazonMaxoPaymentProcessor from './create-amazon-maxo-payment-processor';

describe('AmazonMaxoPaymentStrategy', () => {
    let amazonMaxoPaymentProcessor: AmazonMaxoPaymentProcessor;
    let container: HTMLDivElement;
    let editBillingButton: HTMLDivElement;
    let editShippingButton: HTMLDivElement;
    let finalizeOrderAction: Observable<FinalizeOrderAction>;
    let initializeOffsitePaymentAction: Observable<InitializeOffsitePaymentAction>;
    let orderActionCreator: OrderActionCreator;
    let paymentActionCreator: PaymentActionCreator;
    let paymentMethodActionCreator: PaymentMethodActionCreator;
    let paymentMethodMock: PaymentMethod;
    let paymentStrategyActionCreator: PaymentStrategyActionCreator;
    let requestSender: RequestSender;
    let signInCustomer: jest.Mock;
    let store: CheckoutStore;
    let strategy: AmazonMaxoPaymentStrategy;
    let submitOrderAction: Observable<SubmitOrderAction>;

    beforeEach(() => {
        store = createCheckoutStore(getCheckoutStoreState());
        amazonMaxoPaymentProcessor = createAmazonMaxoPaymentProcessor(store);
        requestSender = createRequestSender();
        signInCustomer = jest.fn();

        const paymentClient = createPaymentClient(store);
        const spamProtection = createSpamProtection(createScriptLoader());
        const registry = createPaymentStrategyRegistry(store, paymentClient, requestSender, spamProtection, 'en_US');
        const paymentMethodRequestSender: PaymentMethodRequestSender = new PaymentMethodRequestSender(requestSender);

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
        initializeOffsitePaymentAction = of(createAction(PaymentActionType.InitializeOffsitePaymentRequested));
        submitOrderAction = of(createAction(OrderActionType.SubmitOrderRequested));
        paymentMethodMock = { ...getAmazonMaxo(), initializationData: { paymentToken: undefined } };

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
        initializeOffsitePaymentAction = of(createAction(PaymentActionType.InitializeOffsitePaymentRequested));

        jest.spyOn(store, 'dispatch');

        jest.spyOn(amazonMaxoPaymentProcessor, 'initialize')
            .mockReturnValue(Promise.resolve());

        jest.spyOn(amazonMaxoPaymentProcessor, 'deinitialize')
            .mockReturnValue(Promise.resolve());

        jest.spyOn(amazonMaxoPaymentProcessor, 'createButton')
            .mockReturnValue(container);

        jest.spyOn(amazonMaxoPaymentProcessor, 'bindButton')
            .mockImplementation(() => {});

        jest.spyOn(orderActionCreator, 'finalizeOrder')
            .mockReturnValue(finalizeOrderAction);

        jest.spyOn(orderActionCreator, 'submitOrder')
            .mockReturnValue(submitOrderAction);

        jest.spyOn(paymentMethodActionCreator, 'loadPaymentMethod')
            .mockResolvedValue(store.getState());

        jest.spyOn(paymentStrategyActionCreator, 'widgetInteraction')
            .mockResolvedValue(store.getState());

        jest.spyOn(store.getState().paymentMethods, 'getPaymentMethod')
            .mockReturnValue(paymentMethodMock);

        jest.spyOn(paymentActionCreator, 'initializeOffsitePayment')
            .mockReturnValue(initializeOffsitePaymentAction);

        strategy = new AmazonMaxoPaymentStrategy(store,
            paymentStrategyActionCreator,
            paymentMethodActionCreator,
            orderActionCreator,
            paymentActionCreator,
            amazonMaxoPaymentProcessor
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

    it('creates an instance of AmazonMaxoPaymentStrategy', () => {
        expect(strategy).toBeInstanceOf(AmazonMaxoPaymentStrategy);
    });

    describe('#initialize()', () => {
        let amazonmaxoInitializeOptions: AmazonMaxoPaymentInitializeOptions;
        let initializeOptions: PaymentInitializeOptions;
        const paymentToken = 'abc123';
        const billingId = 'edit-billing-address-button';
        const shippingId = 'edit-shipping-address-button';

        beforeEach(() => {
            amazonmaxoInitializeOptions = { container: 'container', signInCustomer };
            initializeOptions = { methodId: 'amazonmaxo', amazonmaxo: amazonmaxoInitializeOptions };
        });

        it('creates the signing button if no paymentToken is present on initializationData', async () => {
            await strategy.initialize(initializeOptions);

            expect(amazonMaxoPaymentProcessor.bindButton).not.toHaveBeenCalled();
            expect(amazonMaxoPaymentProcessor.initialize).toHaveBeenCalledWith(paymentMethodMock.id);
            expect(amazonMaxoPaymentProcessor.createButton).toHaveBeenCalledWith(`#${amazonmaxoInitializeOptions.container}`, expect.any(Object));
        });

        it('binds edit buttons if paymentToken is present on initializationData', async () => {
            paymentMethodMock.initializationData.paymentToken = paymentToken;

            await strategy.initialize(initializeOptions);

            expect(amazonMaxoPaymentProcessor.createButton).not.toHaveBeenCalled();
            expect(amazonMaxoPaymentProcessor.initialize).toHaveBeenCalledWith(paymentMethodMock.id);
            expect(amazonMaxoPaymentProcessor.bindButton).toHaveBeenCalledWith(`#${shippingId}`, paymentToken);
            expect(amazonMaxoPaymentProcessor.bindButton).toHaveBeenCalledWith(`#${billingId}`, paymentToken);
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

        it('does not initialize the paymentProcessor if no options.amazonmaxo are provided', () => {
            initializeOptions.amazonmaxo = undefined;

            expect(strategy.initialize(initializeOptions)).rejects.toThrow(InvalidArgumentError);
            expect(amazonMaxoPaymentProcessor.initialize).not.toHaveBeenCalled();
        });

        it('does not initialize the paymentProcessor if no options.methodId are provided', () => {
            initializeOptions.methodId = '';

            expect(strategy.initialize(initializeOptions)).rejects.toThrow(MissingDataError);
            expect(amazonMaxoPaymentProcessor.initialize).not.toHaveBeenCalled();
        });

        it('does not initialize the paymentProcessor if payment method is missing', () => {
            jest.spyOn(store.getState().paymentMethods, 'getPaymentMethod')
                .mockReturnValue(undefined);

            expect(strategy.initialize(initializeOptions)).rejects.toThrow(MissingDataError);
            expect(amazonMaxoPaymentProcessor.initialize).not.toHaveBeenCalled();
        });

        it('does not bind edit billing address button if button do not exist', async () => {
            document.body.removeChild(editBillingButton);
            paymentMethodMock.initializationData.paymentToken = paymentToken;

            await strategy.initialize(initializeOptions);

            expect(amazonMaxoPaymentProcessor.createButton).not.toHaveBeenCalled();
            expect(amazonMaxoPaymentProcessor.initialize).toHaveBeenCalledWith(paymentMethodMock.id);
            expect(amazonMaxoPaymentProcessor.bindButton).toHaveBeenCalledWith(`#${shippingId}`, paymentToken);
            expect(amazonMaxoPaymentProcessor.bindButton).not.toHaveBeenCalledWith(`#${billingId}`, paymentToken);

            document.body.appendChild(editShippingButton);
        });
    });

    describe('#execute()', () => {
        let amazonmaxoInitializeOptions: AmazonMaxoPaymentInitializeOptions;
        let initializeOptions: PaymentInitializeOptions;
        let orderRequestBody: OrderRequestBody;
        const paymentToken = 'abc123';

        beforeEach(async () => {
            amazonmaxoInitializeOptions = { container: 'container', signInCustomer };
            initializeOptions = { methodId: 'amazonmaxo', amazonmaxo: amazonmaxoInitializeOptions };
            orderRequestBody = {
                ...getOrderRequestBody(),
                payment: {
                    methodId: 'amazonmaxo',
                },
            };

            await strategy.initialize(initializeOptions);
        });

        it('shows the spinner if no paymentToken is found on intializationData', async () => {
            await strategy.execute(orderRequestBody, initializeOptions);

            expect(paymentStrategyActionCreator.widgetInteraction).toHaveBeenCalled();
        });

        it('starts offsite flow if paymentToken is found on intializationData', async () => {
            paymentMethodMock.initializationData.paymentToken = paymentToken;

            await strategy.initialize(initializeOptions);

            await strategy.execute(orderRequestBody, initializeOptions);

            expect(orderActionCreator.submitOrder).toHaveBeenCalledWith(omit(orderRequestBody, 'payment'), initializeOptions);
            expect(paymentActionCreator.initializeOffsitePayment).toHaveBeenCalledWith('amazonmaxo', undefined, paymentToken);
        });

        it('fails to execute if strategy is not initialized', () => {
            strategy = new AmazonMaxoPaymentStrategy(store,
                paymentStrategyActionCreator,
                paymentMethodActionCreator,
                orderActionCreator,
                paymentActionCreator,
                amazonMaxoPaymentProcessor
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
    });

    describe('#finalize()', () => {
        const options = { methodId: 'amazonmaxo' };

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
        let amazonmaxoInitializeOptions: AmazonMaxoPaymentInitializeOptions;
        let initializeOptions: PaymentInitializeOptions;

        beforeEach(async () => {
            amazonmaxoInitializeOptions = { container: 'container', signInCustomer };
            initializeOptions = { methodId: 'amazonmaxo', amazonmaxo: amazonmaxoInitializeOptions };
            await strategy.initialize(initializeOptions);
        });

        it('expect to deinitialize the payment processor', async () => {
            await strategy.deinitialize(initializeOptions);

            expect(amazonMaxoPaymentProcessor.deinitialize).toHaveBeenCalled();

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
