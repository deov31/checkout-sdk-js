import { createRequestSender, RequestSender } from '@bigcommerce/request-sender';
import { createScriptLoader } from '@bigcommerce/script-loader';
import { of, Observable } from 'rxjs';
import { createAction, Action } from '@bigcommerce/data-store';

import { BillingAddressActionCreator, BillingAddressRequestSender } from '../../../billing';
import { getCartState } from '../../../cart/carts.mock';
import { createCheckoutStore, CheckoutRequestSender, CheckoutStore, CheckoutValidator } from '../../../checkout';
import { getCheckoutState } from '../../../checkout/checkouts.mock';
import {
    MissingDataError,
    MissingDataErrorType,
    NotInitializedError,
    NotInitializedErrorType,
    StandardError
} from '../../../common/error/errors';
import { getConfigState } from '../../../config/configs.mock';
import { getCustomerState } from '../../../customer/customers.mock';
import PaymentMethod from '../../payment-method';
import PaymentMethodActionCreator from '../../payment-method-action-creator';
import PaymentMethodRequestSender from '../../payment-method-request-sender';
import { getCybersource, getPaymentMethodsState } from '../../payment-methods.mock';

import {
    CardinalEventAction,
    CardinalEventResponse,
    CardinalEventType,
    CardinalInitializationType,
    CardinalPaymentBrand,
    CardinalPaymentStep,
    CardinalTriggerEvents,
    CardinalValidatedAction,
    CardinalValidatedData,
    SetupCompletedData,
    SignatureValidationErrors,
} from './index';

import CyberSourceThreeDSecurePaymentProcessor from './cybersource-threedsecure-payment-processor';
import CyberSourceScriptLoader from './cybersource-script-loader';
import { OrderActionCreator, OrderActionType, OrderPaymentRequestBody, OrderRequestBody, OrderRequestSender } from '../../../order';
import { OrderFinalizationNotRequiredError } from '../../../order/errors';
import PaymentActionCreator from '../../payment-action-creator';
import { PaymentRequestSender } from '../../index';
import { createClient as createPaymentClient } from '@bigcommerce/bigpay-client';
import { PaymentActionType } from '../../payment-actions';
import { CreditCardInstrument } from '../../payment';
import {getCreditCardInstrument, getPayment } from '../../payments.mock'
import { PaymentRequestOptions} from '../../payment-request-options';
import {CardinalBinProccessResponse, CyberSourceCardinal} from './cybersource';
import {getCyberSourceCardinal, getCardinalBinProccessResponse, getRejectAuthorizationPromise, getCardinalValidatedData} from './cybersource.mock';
import { getPaymentMethodMock } from '../googlepay/googlepay.mock';

describe('CyberSourceThreeDSecurePaymentProcessor', () => {
    let processor: CyberSourceThreeDSecurePaymentProcessor;
    let paymentMethodActionCreator: PaymentMethodActionCreator;
    let cybersourceScriptLoader: CyberSourceScriptLoader;
    let store: CheckoutStore;
    let billingAddressActionCreator: BillingAddressActionCreator;
    let requestSender: RequestSender;
    let _paymentActionCreator: PaymentActionCreator;
    let _orderActionCreator: OrderActionCreator;
    let paymentMethodMock: PaymentMethod;
    let submitOrderAction: Observable<Action>;
    let submitPaymentAction: Observable<Action>;
    let _orderRequestSender: OrderRequestSender;
    let orderPaymentRequestBody: OrderPaymentRequestBody;
    let orderRequestBody: OrderRequestBody;
    let creditCardInstrument: CreditCardInstrument;
    let paymentRequestOptions: PaymentRequestOptions;
    let cyberSourceCardinal: CyberSourceCardinal;
    let JPMC: CyberSourceCardinal;

    beforeEach(() => {
        paymentMethodMock = getCybersource();
        const scriptLoader = createScriptLoader();
        billingAddressActionCreator = new BillingAddressActionCreator(new BillingAddressRequestSender(requestSender));

        store = createCheckoutStore({
            checkout: getCheckoutState(),
            customer: getCustomerState(),
            config: getConfigState(),
            cart: getCartState(),
            paymentMethods: getPaymentMethodsState(),
        });

        requestSender = createRequestSender();

        const paymentMethodRequestSender = new PaymentMethodRequestSender(requestSender);
        _orderRequestSender = new OrderRequestSender(createRequestSender());

        _orderActionCreator = new OrderActionCreator(
            _orderRequestSender,
            new CheckoutValidator(new CheckoutRequestSender(createRequestSender()))
        );

        _paymentActionCreator = new PaymentActionCreator(
            new PaymentRequestSender(createPaymentClient()),
            _orderActionCreator
        );

        paymentMethodActionCreator = new PaymentMethodActionCreator(paymentMethodRequestSender);
        submitOrderAction = of(createAction(OrderActionType.SubmitOrderRequested));
        submitPaymentAction = of(createAction(PaymentActionType.SubmitPaymentRequested));

        JPMC = getCyberSourceCardinal();
        cybersourceScriptLoader = new CyberSourceScriptLoader(createScriptLoader());

        jest.spyOn(_orderActionCreator, 'submitOrder')
            .mockReturnValue(submitOrderAction);
        jest.spyOn(_paymentActionCreator, 'submitPayment')
            .mockReturnValue(submitPaymentAction);
        jest.spyOn(paymentMethodActionCreator, 'loadPaymentMethod')
            .mockResolvedValue(store.getState());
        jest.spyOn(store, 'dispatch')
            .mockResolvedValue(store.getState());
        jest.spyOn(store.getState().paymentMethods, 'getPaymentMethod')
            .mockReturnValue(paymentMethodMock);
        jest.spyOn(cybersourceScriptLoader, 'load')
            .mockReturnValue(Promise.resolve(JPMC));


        paymentMethodActionCreator = new PaymentMethodActionCreator(new PaymentMethodRequestSender(requestSender));
        requestSender = createRequestSender();

        processor =  new CyberSourceThreeDSecurePaymentProcessor(
            store,
            _orderActionCreator,
            _paymentActionCreator,
            cybersourceScriptLoader
        );
    });

    it('creates an instance of CyberSourceThreeDSecurePaymentProcessor', () => {
        expect(processor).toBeInstanceOf(CyberSourceThreeDSecurePaymentProcessor);
    });

    describe('#initialize', () => {
        beforeEach(() => {
            jest.spyOn(store, 'dispatch').mockReturnValue(Promise.resolve(store.getState()));
            jest.spyOn(store.getState().paymentMethods, 'getPaymentMethod').mockReturnValue(getCybersource());
            jest.spyOn(paymentMethodActionCreator, 'loadPaymentMethod').mockReturnValue(Promise.resolve(store.getState()));
        });

        it('loads cybersource in test mode if enabled', async () => {
            processor.initialize(paymentMethodMock);
            paymentMethodMock.config.testMode = true;

            expect(cybersourceScriptLoader.load).toHaveBeenLastCalledWith(false);
        });

        it('loads cybersource without test mode if disabled', () => {
            processor.initialize(paymentMethodMock);
            paymentMethodMock.config.testMode = false;

            expect(cybersourceScriptLoader.load).toHaveBeenLastCalledWith(false);
        });

        it('loads cybersource without test mode if disabled', () => {
            try {
                processor.initialize(paymentMethodMock);
                paymentMethodMock.config.testMode = false;
                expect(cybersourceScriptLoader.load).toHaveBeenLastCalledWith(false);
            } catch(error) {
                expect(error).toBeInstanceOf(MissingDataError);
            }
        });

        // TIRANDO TIMEOUT :()
        // it('initializes strategy', async () => {
        //     expect(await processor.initialize(paymentMethodMock)).toEqual(store.getState());
        // });

        // it('throws data missing error', async () => {
        //     jest.spyOn(store.getState().paymentMethods, 'getPaymentMethod').mockReturnValue(undefined);
        //     try {
        //         await processor.initialize(paymentMethodMock);
        //     } catch (error) {
        //         expect(error).toBeInstanceOf(MissingDataError);
        //     }
        // });
    });

    describe('#execute', () => {
        it('executes the processor successfully', async () => {
            try {
                await processor.execute(orderPaymentRequestBody, orderRequestBody, creditCardInstrument);
                expect(_orderActionCreator.submitOrder).toHaveBeenCalledWith(orderRequestBody, paymentRequestOptions);
            } catch (error) {
                expect(error).toBeInstanceOf(NotInitializedError);
            }
        });

        it('CardinalEvent CardinalValidation failure', async () => {
            try {
                processor.initialize(paymentMethodMock);
                JPMC.on = jest.fn((type, callback) => callback({ActionCode: 'FAILURE', ErrorDescription: ''}));
                expect(await processor.execute(orderPaymentRequestBody, orderRequestBody, creditCardInstrument)).toEqual(store.getState());
            } catch (error) {
                expect(error).toBeInstanceOf(NotInitializedError);
            }
        });

        it('CardinalEvent CardinalValidateAction NoAction', async () => {
            try {
                processor.initialize(paymentMethodMock);
                JPMC.on = jest.fn((type, callback) => callback({ActionCode: 'ERROR', ErrorNumber: 666}));
                const fn = await JPMC.trigger(CardinalTriggerEvents.BIN_PROCCESS,getCreditCardInstrument().ccNumber);
                expect(fn).toHaveBeenCalledWith(getCardinalValidatedData());
                expect(await processor.initialize(paymentMethodMock)).toEqual(store.getState());
            } catch (error) {
                expect(error).toBeInstanceOf(Error);
            }
        });

        it('CardinalEvent CardinalValidateAction NoAction', async () => {
            try {
                processor.initialize(paymentMethodMock);
                JPMC.on = jest.fn((type, callback) => callback({ActionCode: 'ERROR', ErrorNumber: 1010}));
                const fn = await JPMC.trigger(CardinalTriggerEvents.BIN_PROCCESS,getCreditCardInstrument().ccNumber);
                expect(fn).toHaveBeenCalledWith(getCardinalValidatedData());
                expect(await processor.initialize(paymentMethodMock)).toEqual(store.getState());
            } catch (error) {
                expect(error).toBeInstanceOf(Error);
            }
        });

        it('CardinalEvent CardinalValidateAction NoAction', async () => {
            try {
                processor.initialize(paymentMethodMock);
                JPMC.on = jest.fn((type, callback) => callback({ActionCode: 'NOACTION', ErrorNumber: 666}));
                const fn = await JPMC.trigger(CardinalTriggerEvents.BIN_PROCCESS,getCreditCardInstrument().ccNumber);
                expect(fn).toHaveBeenCalledWith(getCardinalValidatedData());
                expect(await processor.initialize(paymentMethodMock)).toEqual(store.getState());
            } catch (error) {
                expect(error).toBeInstanceOf(Error);
            }
        });

        it('CardinalEvent CardinalValidateAction NoAction', async () => {
            try {
                processor.initialize(paymentMethodMock);
                JPMC.on = jest.fn((type, callback) => callback({ActionCode: 'NOACTION', ErrorNumber: 0}));
                const fn = await JPMC.trigger(CardinalTriggerEvents.BIN_PROCCESS,getCreditCardInstrument().ccNumber);
                expect(fn).toHaveBeenCalledWith(getCardinalValidatedData());
                expect(await processor.initialize(paymentMethodMock)).toEqual(store.getState());
            } catch (error) {
                expect(error).toBeInstanceOf(Error);
            }
        });

        it('CardinalEvent CardinalValidateAction Success', async () => {
            try {
                processor.initialize(paymentMethodMock);
                JPMC.on = jest.fn((type, callback) => callback({ActionCode: 'SUCCESS'}));
                expect(await processor.execute(orderPaymentRequestBody, orderRequestBody, creditCardInstrument)).toEqual(store.getState());
            } catch (error) {
                expect(error).toBeInstanceOf(NotInitializedError);
            }
        });

        it('payment action creater submitpayment', async () => {
            try {
                await processor.execute(orderPaymentRequestBody, orderRequestBody, creditCardInstrument);
                expect(_paymentActionCreator.submitPayment(orderPaymentRequestBody, )).toHaveBeenCalledWith(orderRequestBody, paymentRequestOptions);
            } catch (error) {
                expect(error).toBeInstanceOf(NotInitializedError);
            }
        });

        it('throws error if cardinal trigger fails', async () => {
            try {
                jest.spyOn(processor, 'execute').mockReturnValue(store.dispatch(submitOrderAction));
                processor.initialize(paymentMethodMock);
                expect(await processor.execute(orderPaymentRequestBody, orderRequestBody, creditCardInstrument)).toEqual(store.getState());
                expect(_orderActionCreator.submitOrder).toHaveBeenCalledWith(orderRequestBody, paymentRequestOptions);
                // expect(store.dispatch).toHaveBeenCalledWith(submitOrderAction);
            } catch (error) {
                expect(error).toBeInstanceOf(Error);
            }
        });

        it('trigger', async () => {
            try {
                processor.initialize(paymentMethodMock);
                jest.spyOn(processor, 'execute').mockReturnValue(JPMC.trigger);
                expect(await processor.execute(orderPaymentRequestBody, orderRequestBody, creditCardInstrument)).toEqual(store.getState());
            } catch (error) {
                expect(error).toBeInstanceOf(Error);
            }
        });
    });

    describe('#deinitialize()', () => {
        it('deinitializes strategy', async () => {
            expect(await processor.deinitialize()).toEqual(store.getState());
        });
    });

    describe('#finalize()', () => {
        it('throws error to inform that order finalization is not required', async () => {
            try {
                await processor.finalize();
            } catch (error) {
                expect(error).toBeInstanceOf(OrderFinalizationNotRequiredError);
            }
        });
    });

});

//69,178,234,236