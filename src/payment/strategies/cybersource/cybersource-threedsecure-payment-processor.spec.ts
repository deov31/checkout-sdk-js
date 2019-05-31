import { createClient as createPaymentClient } from '@bigcommerce/bigpay-client';
import { createRequestSender } from '@bigcommerce/request-sender';
import { createScriptLoader } from '@bigcommerce/script-loader';

import { getCartState } from '../../../cart/carts.mock';
import { createCheckoutStore, CheckoutRequestSender, CheckoutStore, CheckoutValidator } from '../../../checkout';
import { getCheckoutState } from '../../../checkout/checkouts.mock';
import MissingDataError from '../../../common/error/errors/missing-data-error';
import { getConfigState } from '../../../config/configs.mock';
import { getCustomerState } from '../../../customer/customers.mock';
import { OrderActionCreator, OrderRequestSender } from '../../../order';
import { PaymentRequestSender } from '../../index';
import PaymentActionCreator from '../../payment-action-creator';
import PaymentMethod from '../../payment-method';
import { getCybersource, getPaymentMethodsState } from '../../payment-methods.mock';

import {CardinalValidatedAction, CardinalValidatedData, CyberSourceCardinal, Payment, CardinalBinProccessResponse, CardinalTriggerEvents} from './cybersource';
import CyberSourceScriptLoader from './cybersource-script-loader';
import CyberSourceThreeDSecurePaymentProcessor from './cybersource-threedsecure-payment-processor';
import {getCardinalValidatedDataWithSetupError, getCybersourceCardinal, getCybersourcePaymentData, getCardinalValidatedDataWithSetupSuccess, getCardinalBinProccessResponse} from './cybersource.mock';
import { CardinalEventType } from './index';
import { getOrderRequestBody } from '../../../order/internal-orders.mock';
import { getCreditCardInstrument } from '../../payments.mock';
import { NotInitializedError, RequestError } from '../../../common/error/errors';
import { InternalErrorResponseBody } from '../../../common/error';
import { getErrorResponse } from '../../../common/http-request/responses.mock';
import mapFromInternalErrorResponse from '../../../common/error/errors/map-from-internal-error-response';

describe('CyberSourceThreeDSecurePaymentProcessor', () => {
    let processor: CyberSourceThreeDSecurePaymentProcessor;
    let cybersourceScriptLoader: CyberSourceScriptLoader;
    let store: CheckoutStore;
    let _paymentActionCreator: PaymentActionCreator;
    let _orderActionCreator: OrderActionCreator;
    let paymentMethodMock: PaymentMethod;
    let _orderRequestSender: OrderRequestSender;
    let cardinal: CyberSourceCardinal;
    let result: CardinalBinProccessResponse;

    beforeEach(() => {
        store = createCheckoutStore({
            checkout: getCheckoutState(),
            customer: getCustomerState(),
            config: getConfigState(),
            cart: getCartState(),
            paymentMethods: getPaymentMethodsState(),
        });
        _orderRequestSender = new OrderRequestSender(createRequestSender());

        _orderActionCreator = new OrderActionCreator(
            _orderRequestSender,
            new CheckoutValidator(new CheckoutRequestSender(createRequestSender()))
        );

        _paymentActionCreator = new PaymentActionCreator(
            new PaymentRequestSender(createPaymentClient()),
            _orderActionCreator
        );

        cybersourceScriptLoader = new CyberSourceScriptLoader(createScriptLoader());

        jest.spyOn(store, 'dispatch')
            .mockResolvedValue(store.getState());
        jest.spyOn(store.getState().paymentMethods, 'getPaymentMethod')
            .mockReturnValue(paymentMethodMock);

        processor =  new CyberSourceThreeDSecurePaymentProcessor(
            store,
            _orderActionCreator,
            _paymentActionCreator,
            cybersourceScriptLoader
        );
    });

    describe('#initialize', () => {
        beforeEach(() => {
            paymentMethodMock = getCybersource();
            cardinal = getCybersourceCardinal();

            jest.spyOn(cybersourceScriptLoader, 'load')
                .mockReturnValue(Promise.resolve(cardinal));
        });

        it('initializes successfully', async () => {
            let call: () => {};

            cardinal.on = jest.fn((type, callback) => {
                if (type.toString() === CardinalEventType.SetupCompleted) {
                    call = callback;
                } else {
                    jest.fn();
                }
            });

            jest.spyOn(cardinal, 'setup').mockImplementation(() => {
                call();
            });

            const promise = await processor.initialize(paymentMethodMock);

            expect(cardinal.on).toHaveBeenCalledWith(CardinalEventType.SetupCompleted, expect.any(Function));
            expect(promise).toBe(store.getState());
        });

        it('initializes incorrectly', async () => {
            let call: (data: CardinalValidatedData, jwt: string) => {};

            cardinal.on = jest.fn((type, callback) => {
                if (type.toString() === CardinalEventType.Validated) {
                    call = callback;
                } else {
                    jest.fn();
                }
            });

            jest.spyOn(cardinal, 'setup').mockImplementation(() => {
                call(getCardinalValidatedDataWithSetupError(), '');
            });

            try {
                await processor.initialize(paymentMethodMock);
            } catch (error) {
                expect(error).toBeInstanceOf(MissingDataError);
            }
        });

        it('throws when initialize options are undefined', () => {
            const paymentMethod = paymentMethodMock;
            paymentMethod.clientToken = undefined;

            expect(() => processor.initialize(paymentMethod))
                .toThrow(MissingDataError);
        });
    });

    describe('#execute', () => {
        beforeEach(() => {
            paymentMethodMock = getCybersource();
            cardinal = getCybersourceCardinal();

            let call: () => {};

            cardinal.on = jest.fn((type, callback) => {
                if (type.toString() === CardinalEventType.SetupCompleted) {
                    call = callback;
                } else {
                    jest.fn();
                }
            });
            cardinal.trigger = jest.fn(() => Promise.resolve(getCardinalBinProccessResponse()));

            jest.spyOn(cybersourceScriptLoader, 'load')
                .mockReturnValue(Promise.resolve(cardinal));

            jest.spyOn(cardinal, 'setup').mockImplementation(() => {
                call();
            });
        });

        it('executes successfully', async () => {
            await processor.initialize(paymentMethodMock);

            jest.spyOn(store, 'dispatch').mockReturnValue(Promise.resolve(store.getState()));
            jest.spyOn(_orderActionCreator, 'submitOrder').mockReturnValue(Promise.resolve());
            jest.spyOn(_paymentActionCreator, 'submitPayment').mockReturnValue(Promise.resolve());

            const response = await processor.execute(getCybersourcePaymentData(), getOrderRequestBody(), getCreditCardInstrument());

            expect(cardinal.trigger).toHaveBeenCalled();
            expect(_orderActionCreator.submitOrder).toHaveBeenCalled();
            expect(_paymentActionCreator.submitPayment).toHaveBeenCalled();
            expect(response).toBe(store.getState());
        });

        it('throws when cardinal is not initialized', async () => {
            const promise = processor.execute(getCybersourcePaymentData(), getOrderRequestBody(), getCreditCardInstrument());

            return expect(promise).rejects.toThrow(NotInitializedError);
        });

        it('throws an error when cardinal.trigger failure', async () => {
            cardinal.trigger = jest.fn(() => Promise.resolve(undefined));

            await processor.initialize(paymentMethodMock);
            const promise = processor.execute(getCybersourcePaymentData(), getOrderRequestBody(), getCreditCardInstrument());

            return expect(promise).rejects.toThrow(NotInitializedError);
        });

        it('rejects an error when submitOrder failure', async () => {
            await processor.initialize(paymentMethodMock);

            jest.spyOn(store, 'dispatch').mockReturnValue(Promise.reject('error'));
            jest.spyOn(_orderActionCreator, 'submitOrder').mockReturnValue(Promise.resolve());
            jest.spyOn(_paymentActionCreator, 'submitPayment').mockReturnValue(Promise.resolve());

            const promise = processor.execute(getCybersourcePaymentData(), getOrderRequestBody(), getCreditCardInstrument());

            return expect(promise).rejects.toBe('error');
        });

        it('rejects an error when submitOrder failure with code enrolled_card', async () => {
            await processor.initialize(paymentMethodMock);

            let error: RequestError<InternalErrorResponseBody>;

            const response = getErrorResponse({
                status: 400,
                title: 'Error with payment provider',
                type: 'invalid_payment',
                errors: [ 'enrolled_card' ],
            });
    
            error = mapFromInternalErrorResponse(response);

            jest.spyOn(store, 'dispatch').mockReturnValue(Promise.reject(error));
            jest.spyOn(_orderActionCreator, 'submitOrder').mockReturnValue(Promise.resolve());
            jest.spyOn(_paymentActionCreator, 'submitPayment').mockReturnValue(Promise.resolve());

            const promise = processor.execute(getCybersourcePaymentData(), getOrderRequestBody(), getCreditCardInstrument());

            return expect(promise).rejects.toBe(error);
        });
    });
});
