import { of, Observable, empty } from 'rxjs';

import { createClient as createPaymentClient } from '@bigcommerce/bigpay-client';
import { createAction, Action } from '@bigcommerce/data-store';
import { createRequestSender, RequestSender } from '@bigcommerce/request-sender';
import { createScriptLoader } from '@bigcommerce/script-loader';

import { getCartState } from '../../../cart/carts.mock';
import { createCheckoutStore, CheckoutRequestSender, CheckoutStore, CheckoutValidator } from '../../../checkout';
import { getCheckoutState } from '../../../checkout/checkouts.mock';
import {
    MissingDataError,
    NotInitializedError,
    NotInitializedErrorType,
    RequestError,
} from '../../../common/error/errors';
import { getConfigState } from '../../../config/configs.mock';
import { getCustomerState } from '../../../customer/customers.mock';
import PaymentMethod from '../../payment-method';
import PaymentMethodActionCreator from '../../payment-method-action-creator';
import PaymentMethodRequestSender from '../../payment-method-request-sender';
import { getCybersource, getPaymentMethodsState } from '../../payment-methods.mock';

import { OrderActionCreator, OrderActionType, OrderRequestSender } from '../../../order';
import { OrderFinalizationNotRequiredError } from '../../../order/errors';
import { getOrderRequestBody } from '../../../order/internal-orders.mock';
import { PaymentRequestSender } from '../../index';
import PaymentActionCreator from '../../payment-action-creator';
import { PaymentActionType } from '../../payment-actions';
import { getCreditCardInstrument, getPayment, getPaymentRequestBody } from '../../payments.mock';

import {
    CardinalTriggerEvents,
} from './index';

import { CyberSourceCardinal, CardinalEventType, SetupCompletedData, CardinalPaymentStep, CardinalEventAction } from './cybersource';
import CyberSourceScriptLoader from './cybersource-script-loader';
import CyberSourceThreeDSecurePaymentProcessor from './cybersource-threedsecure-payment-processor';
import { getCardinalBinProccessResponse, getCardinalValidatedData, getCybersourceCardinal, getCybersourcePaymentData, getCybersourcePaymentRequestOptions } from './cybersource.mock';
import { ErrorActionType } from '../../../common/error';

describe('CyberSourceThreeDSecurePaymentProcessor', () => {
    let processor: CyberSourceThreeDSecurePaymentProcessor;
    let paymentMethodActionCreator: PaymentMethodActionCreator;
    let cybersourceScriptLoader: CyberSourceScriptLoader;
    let store: CheckoutStore;
    let requestSender: RequestSender;
    let _paymentActionCreator: PaymentActionCreator;
    let _orderActionCreator: OrderActionCreator;
    let paymentMethodMock: PaymentMethod;
    let submitOrderAction: Observable<Action>;
    let submitPaymentAction: Observable<Action>;
    let _orderRequestSender: OrderRequestSender;
    let JPMC: CyberSourceCardinal;
    let setupCompletedData: SetupCompletedData;

    beforeEach(() => {
        paymentMethodMock = getCybersource();

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

        JPMC = getCybersourceCardinal();
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
        it('throws when initialize options are undefined', () => {
            const paymentMethod = paymentMethodMock;
            paymentMethod.clientToken = undefined;

            expect(() => processor.initialize(paymentMethod))
                .toThrow(MissingDataError);
        });

        it('loads cybersource in test mode if enabled', async () => {
            const paymentMethod = paymentMethodMock;
            const testMode = paymentMethod.config.testMode = true;
            processor.initialize(paymentMethod);

            expect(cybersourceScriptLoader.load).toHaveBeenLastCalledWith(testMode);
        });

        it('loads cybersource without test mode if disabled', () => {
            processor.initialize(paymentMethodMock);

            expect(cybersourceScriptLoader.load).toHaveBeenLastCalledWith(false);
        });
    });

    describe('#execute', () => {
        beforeEach(() => {

        });

        it('when CardinalValidateAction Success', async () => {
            try {
                processor.initialize(paymentMethodMock);
                JPMC.on = jest.fn((type, callback) => callback({ActionCode: 'SUCCESS'}));
                expect(await processor.execute(getCybersourcePaymentData(), getOrderRequestBody(), getCreditCardInstrument())).toEqual(store.getState());
            } catch (error) {
                expect(error).toBeInstanceOf(NotInitializedError);
            }
        });

        it('CardinalEvent CardinalValidateAction NoAction', async () => {
            try {
                processor.initialize(paymentMethodMock);
                JPMC.on = jest.fn((type, callback) => callback({ActionCode: 'NOACTION', ErrorNumber: 1010}));
                const fn = await JPMC.trigger(CardinalTriggerEvents.BIN_PROCCESS, getCreditCardInstrument().ccNumber);
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
                const fn = await JPMC.trigger(CardinalTriggerEvents.BIN_PROCCESS, getCreditCardInstrument().ccNumber);
                expect(fn).toHaveBeenCalledWith(getCardinalValidatedData());
                expect(await processor.initialize(paymentMethodMock)).toEqual(store.getState());
            } catch (error) {
                expect(error).toBeInstanceOf(Error);
            }
        });

        it('CardinalEvent CardinalValidation failure', async () => {
            try {
                processor.initialize(paymentMethodMock);
                JPMC.on = jest.fn((type, callback) => callback({ActionCode: 'FAILURE', ErrorDescription: ''}));
                expect(await processor.execute(getCybersourcePaymentData(), getOrderRequestBody(), getCreditCardInstrument())).toEqual(store.getState());
            } catch (error) {
                expect(error).toBeInstanceOf(NotInitializedError);
            }
        });

        it('CardinalEvent CardinalValidateAction NoAction', async () => {
            try {
                processor.initialize(paymentMethodMock);
                JPMC.on = jest.fn((type, callback) => callback({ActionCode: 'ERROR', ErrorNumber: 1010}));
                const fn = await JPMC.trigger(CardinalTriggerEvents.BIN_PROCCESS, getCreditCardInstrument().ccNumber);
                expect(fn).toHaveBeenCalledWith(getCardinalValidatedData());
                expect(await processor.initialize(paymentMethodMock)).toEqual(store.getState());
            } catch (error) {
                expect(error).toBeInstanceOf(Error);
            }
        });

        it('CardinalEvent CardinalValidateAction NoAction', async () => {
            try {
                processor.initialize(paymentMethodMock);
                JPMC.on = jest.fn((type, callback) => callback({ActionCode: 'ERROR', ErrorNumber: 123}));
                const fn = await JPMC.trigger(CardinalTriggerEvents.BIN_PROCCESS, getCreditCardInstrument().ccNumber);
                expect(fn).toHaveBeenCalledWith(getCardinalValidatedData());
                expect(await processor.initialize(paymentMethodMock)).toEqual(store.getState());
            } catch (error) {
                expect(error).toBeInstanceOf(Error);
            }
        });

        it('throws a NotInitializedError', async () => {
            processor.initialize(paymentMethodMock);
            JPMC.trigger = jest.fn().mockResolvedValue(Promise.resolve());
            await JPMC.trigger(CardinalTriggerEvents.BIN_PROCCESS, getCreditCardInstrument().ccNumber);
            getCardinalBinProccessResponse().Status = false;

            return expect(() => processor.execute(getCybersourcePaymentData(), getOrderRequestBody(), getCreditCardInstrument()))
                .toThrow(NotInitializedError);
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
