import { createRequestSender, RequestSender } from '@bigcommerce/request-sender';
import { createScriptLoader } from '@bigcommerce/script-loader';

import { getCartState } from '../../../cart/carts.mock';
import { createCheckoutStore, CheckoutStore } from '../../../checkout';
import { getCheckoutState } from '../../../checkout/checkouts.mock';
import { MissingDataError, NotInitializedError } from '../../../common/error/errors';
import { getConfigState } from '../../../config/configs.mock';
import { getCustomerState } from '../../../customer/customers.mock';
import PaymentMethodActionCreator from '../../payment-method-action-creator';
import PaymentMethodRequestSender from '../../payment-method-request-sender';
import { getAmazonMaxo, getPaymentMethodsState } from '../../payment-methods.mock';

import { AmazonMaxoClient } from './amazon-maxo';
import AmazonMaxoPaymentProcessor from './amazon-maxo-payment-processor';
import AmazonMaxoScriptLoader from './amazon-maxo-script-loader';
import { getAmazonMaxoButtonParamsMock, getAmazonMaxoSDKMock } from './amazon-maxo.mock';

describe('AmazonMaxoPaymentProcessor', () => {
    let processor: AmazonMaxoPaymentProcessor;
    let paymentMethodActionCreator: PaymentMethodActionCreator;
    let amazonMaxoScriptLoader: AmazonMaxoScriptLoader;
    let store: CheckoutStore;
    let clientMock: AmazonMaxoClient;
    let requestSender: RequestSender;

    beforeEach(() => {
        const scriptLoader = createScriptLoader();

        store = createCheckoutStore({
            checkout: getCheckoutState(),
            customer: getCustomerState(),
            config: getConfigState(),
            cart: getCartState(),
            paymentMethods: getPaymentMethodsState(),
        });
        paymentMethodActionCreator = new PaymentMethodActionCreator(new PaymentMethodRequestSender(requestSender));
        amazonMaxoScriptLoader = new AmazonMaxoScriptLoader(scriptLoader);
        requestSender = createRequestSender();

        processor =  new AmazonMaxoPaymentProcessor(
            store,
            paymentMethodActionCreator,
            amazonMaxoScriptLoader
        );
    });

    describe('#initialize', () => {
        beforeEach(() => {
            const amazonMaxoSDK = getAmazonMaxoSDKMock();
            clientMock = {
                renderButton: jest.fn(() => Promise.resolve(new HTMLElement())),
                bindChangeAction: () => null,
                signout: () => null,
            };
            amazonMaxoSDK.Pay.renderButton = jest.fn(() => clientMock);

            jest.spyOn(amazonMaxoScriptLoader, 'load').mockReturnValue(Promise.resolve(amazonMaxoSDK));
        });

        it('creates an instance of AmazonMaxoPaymentProcessor', () => {
            expect(processor).toBeInstanceOf(AmazonMaxoPaymentProcessor);
        });

        it('initializes processor successfully', async () => {
            jest.spyOn(store, 'dispatch').mockReturnValue(Promise.resolve(store.getState()));
            jest.spyOn(store.getState().paymentMethods, 'getPaymentMethod').mockReturnValue(getAmazonMaxo());
            jest.spyOn(paymentMethodActionCreator, 'loadPaymentMethod').mockReturnValue(Promise.resolve(store.getState()));

            await processor.initialize('amazonMaxo');

            expect(amazonMaxoScriptLoader.load).toHaveBeenCalled();
        });

        it('fails to initialize processor without paymentMethod', async () => {
            jest.spyOn(store, 'dispatch').mockReturnValue(Promise.resolve(store.getState()));
            jest.spyOn(store.getState().paymentMethods, 'getPaymentMethod').mockReturnValue(undefined);
            jest.spyOn(paymentMethodActionCreator, 'loadPaymentMethod').mockReturnValue(Promise.resolve(store.getState()));

            await expect(processor.initialize('amazonmaxo') ).rejects.toThrow(MissingDataError);
        });
    });

    describe('#deinitialize', () => {
        it('deinitializes processor successfully', () => {
            expect(processor.deinitialize()).toBeTruthy();
        });
    });

    describe('#bindButton', () => {
        const sessionId = 'ACB123';
        const buttonName = 'bindableButton';

        beforeEach(() => {
            const amazonMaxoSDK = getAmazonMaxoSDKMock();
            clientMock = {
                renderButton: (jest.fn(() => Promise.resolve())),
                bindChangeAction: jest.fn(),
                signout: () => null,
            };

            amazonMaxoSDK.Pay = clientMock;

            jest.spyOn(amazonMaxoScriptLoader, 'load').mockReturnValue(Promise.resolve(amazonMaxoSDK));
            jest.spyOn(store, 'dispatch').mockReturnValue(Promise.resolve(store.getState()));
            jest.spyOn(store.getState().paymentMethods, 'getPaymentMethod').mockReturnValue(getAmazonMaxo());
            jest.spyOn(paymentMethodActionCreator, 'loadPaymentMethod').mockReturnValue(Promise.resolve(store.getState()));
        });

        it('bind the button successfully', async () => {
            const bindOptions = {
                amazonCheckoutSessionId: sessionId,
                changeAction: 'changeAddress',
            };

            await processor.initialize('amazonMaxo');

            processor.bindButton(buttonName, sessionId);

            expect(clientMock.bindChangeAction).toHaveBeenCalledWith(buttonName, bindOptions);
        });

        it('does not bind the button if the processor is not initialized previously', () => {
            expect(() => processor.bindButton(buttonName, sessionId)).toThrow(NotInitializedError);
        });
    });

    describe('#signout', () => {
        const methodId = 'amazonmaxo';

        beforeEach(() => {
            const amazonMaxoSDK = getAmazonMaxoSDKMock();
            clientMock = {
                renderButton: (jest.fn(() => Promise.resolve())),
                bindChangeAction: jest.fn(),
                signout:  jest.fn(),
            };

            amazonMaxoSDK.Pay = clientMock;

            jest.spyOn(amazonMaxoScriptLoader, 'load').mockReturnValue(Promise.resolve(amazonMaxoSDK));
            jest.spyOn(store, 'dispatch').mockReturnValue(Promise.resolve(store.getState()));
            jest.spyOn(store.getState().paymentMethods, 'getPaymentMethod').mockReturnValue(getAmazonMaxo());
            jest.spyOn(paymentMethodActionCreator, 'loadPaymentMethod').mockReturnValue(Promise.resolve(store.getState()));
        });

        it('loads the SDK when the SDK is not loaded', async () => {
            await processor.signout(methodId);

            expect(amazonMaxoScriptLoader.load).toHaveBeenCalled();
        });

        it('signouts succesfully when the SDK is previouly loaded', async () => {
            await processor.initialize('amazonMaxo');

            await processor.signout(methodId);

            expect(clientMock.signout).toHaveBeenCalled();
        });
    });

    describe('#createButton', () => {
        beforeEach(() => {
            const amazonMaxoSDK = getAmazonMaxoSDKMock();
            clientMock = {
                renderButton: jest.fn(() => Promise.resolve()),
                bindChangeAction: () => null,
                signout: () => null,
            };

            amazonMaxoSDK.Pay = clientMock;

            jest.spyOn(amazonMaxoScriptLoader, 'load').mockReturnValue(Promise.resolve(amazonMaxoSDK));
            jest.spyOn(store, 'dispatch').mockReturnValue(Promise.resolve(store.getState()));
            jest.spyOn(store.getState().paymentMethods, 'getPaymentMethod').mockReturnValue(getAmazonMaxo());
            jest.spyOn(paymentMethodActionCreator, 'loadPaymentMethod').mockReturnValue(Promise.resolve(store.getState()));
        });

        it('creates the html button element', async () => {
            await processor.initialize('amazonMaxo');
            await processor.createButton('container', getAmazonMaxoButtonParamsMock());

            expect(clientMock.renderButton).toHaveBeenCalled();
        });

        it('throws an error when amazonMaxoSDK is not initialized', async () => {

            await expect(() => {processor.createButton('container', getAmazonMaxoButtonParamsMock()); } ).toThrow(NotInitializedError);
        });
    });
});
