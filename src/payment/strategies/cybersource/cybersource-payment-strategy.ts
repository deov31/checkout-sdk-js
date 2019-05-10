import { includes, some } from 'lodash';
import { Subject } from 'rxjs/index';
import { take } from 'rxjs/operators';

import { CheckoutStore, InternalCheckoutSelectors } from '../../../checkout';
import {
    MissingDataError, MissingDataErrorType, NotInitializedError, NotInitializedErrorType,
    RequestError
} from '../../../common/error/errors';
import StandardError from '../../../common/error/errors/standard-error';
import { OrderActionCreator } from '../../../order';
import { OrderFinalizationNotRequiredError } from '../../../order/errors';
import OrderRequestBody from '../../../order/order-request-body';
import PaymentMethodCancelledError from '../../errors/payment-method-cancelled-error';
import { CreditCardInstrument } from '../../payment';
import PaymentActionCreator from '../../payment-action-creator';
import PaymentMethod from '../../payment-method';
import PaymentMethodActionCreator from '../../payment-method-action-creator';
import { PaymentInitializeOptions, PaymentRequestOptions } from '../../payment-request-options';
import PaymentStrategy from '../payment-strategy';

import {
    default as SignatureValidationErrors,
    CardinalEventResponse, CardinalEventType, CardinalInitializationType, CardinalPaymentBrand, CardinalPaymentStep,
    CardinalTriggerEvents,
    CardinalValidatedAction,
    CardinalValidatedData, CyberSourceCardinal, SetupCompleteData
} from './cybersource';
import CyberSourceScriptLoader from './cybersource-script-loader';

export default class CyberSourcePaymentStrategy implements PaymentStrategy {
    private _Cardinal?: CyberSourceCardinal;
    private _paymentMethod?: PaymentMethod;
    private _cardinalEvent$: Subject<CardinalEventResponse>;
    private _isSetupCompleted = false;
    private _cardinalSessionId?: string;

    constructor(
        private _store: CheckoutStore,
        private _orderActionCreator: OrderActionCreator,
        private _paymentActionCreator: PaymentActionCreator,
        private _paymentMethodActionCreator: PaymentMethodActionCreator,
        private _CyberSourceScriptLoader: CyberSourceScriptLoader
    ) {
        this._cardinalEvent$ = new Subject();
    }

    initialize(options: PaymentInitializeOptions): Promise<InternalCheckoutSelectors> {
        const { methodId } = options;

        return this._store.dispatch(this._paymentMethodActionCreator.loadPaymentMethod('cybersourcedirect')).then( state => {
            this._paymentMethod = state.paymentMethods.getPaymentMethod(methodId);

            if (!this._paymentMethod || !this._paymentMethod.clientToken) {
                throw new MissingDataError(MissingDataErrorType.MissingPaymentMethod);
            }

            const clientToken = this._paymentMethod.clientToken;

            return this._CyberSourceScriptLoader.load(this._paymentMethod.config.testMode)
                .then(Cardinal => {
                    this._Cardinal = Cardinal;

                    if (!this._isSetupCompleted) {
                        this._Cardinal.configure({
                            logging: {
                                level: 'on',
                            },
                        });

                        this._Cardinal.on(CardinalEventType.SetupCompleted, (setupCompletedData: SetupCompleteData) => {
                            this._cardinalSessionId = setupCompletedData.sessionId;
                        });

                        this._Cardinal.on(CardinalEventType.Validated, (data: CardinalValidatedData, jwt: string) => {
                            switch (data.ActionCode) {
                                case CardinalValidatedAction.SUCCCESS:
                                    this._resolveAuthorizationPromise(jwt);
                                    break;
                                case CardinalValidatedAction.NOACTION:
                                    if (data.ErrorNumber > 0) {
                                    } else {
                                        this._resolveAuthorizationPromise(jwt);
                                    }
                                    break;
                                case CardinalValidatedAction.FAILURE:
                                    if (data.ErrorNumber > 0) {
                                    } else {
                                        this._rejectAuthorizationPromise(data);
                                    }
                                    break;
                                case CardinalValidatedAction.ERROR:
                                    if (includes(SignatureValidationErrors, data.ErrorNumber)) {
                                        this._rejectSetupEvent();
                                    } else {
                                    }
                            }
                        });

                        this._Cardinal.setup(CardinalInitializationType.Init, {
                            jwt: clientToken,
                        });

                        this._isSetupCompleted = true;

                        this._cardinalEvent$
                            .pipe(take(1))
                            .subscribe((event: CardinalEventResponse) => {
                                if (event.type === CardinalPaymentStep.SETUP) {
                                    if (!event.status) {
                                        throw new MissingDataError(MissingDataErrorType.MissingPaymentMethod);
                                    }
                                }
                            });
                    }
                });
        }).then(() => this._store.getState());
    }

    execute(payload: OrderRequestBody, options?: PaymentRequestOptions): Promise<InternalCheckoutSelectors> {
        const { payment, ...order } = payload;
        const paymentData = payment && payment.paymentData as CreditCardInstrument;

        if (!payment || !paymentData) {
            throw new MissingDataError(MissingDataErrorType.MissingPaymentMethod);
        }

        if (!this._Cardinal) {
            throw new NotInitializedError(NotInitializedErrorType.PaymentNotInitialized);
        }

        return this._Cardinal.trigger(CardinalTriggerEvents.BIN_PROCCESS, paymentData.ccNumber).then(result => {
            if (result && result.Status) {
                return this._store.dispatch(this._orderActionCreator.submitOrder(order, options))
                    .then(() =>
                        this._store.dispatch(
                            this._paymentActionCreator.submitPayment({
                                ...payment,
                                paymentData: this._addExtraData(paymentData, { transactionId: this._cardinalSessionId }),
                            })
                        )
                    ).catch(error => {
                        if (!(error instanceof RequestError) || !some(error.body.errors, { code: 'enrolled_card' })) {
                            return Promise.reject(error);
                        }

                        if (!this._Cardinal) {
                            throw new NotInitializedError(NotInitializedErrorType.PaymentNotInitialized);
                        }

                        const continueObject = {
                            AcsUrl: error.body.three_ds_result.acs_url,
                            Payload: error.body.three_ds_result.merchant_data,
                        };

                        const partialOrder = {
                            OrderDetails: {
                                TransactionId: error.body.three_ds_result.payer_auth_request,
                            },
                        };

                        this._Cardinal.continue(CardinalPaymentBrand.CCA, continueObject, partialOrder);

                        // If credit card is enrolled in 3DS Cybersource will handle the rest of the flow so
                        return new Promise((resolve, reject) => {
                                this._cardinalEvent$
                                    .pipe(take(1))
                                    .subscribe((event: CardinalEventResponse) => {
                                        if (event.type === CardinalPaymentStep.AUTHORIZATION) {
                                            if (event.status) {
                                                resolve(event.jwt);
                                            } else {
                                                reject(new PaymentMethodCancelledError());
                                            }
                                        }
                                    });
                            }).then(jwt =>
                                this._store.dispatch(
                                    this._paymentActionCreator.submitPayment({
                                        ...payment,
                                        paymentData: this._addExtraData(paymentData, { transactionId: this._cardinalSessionId, jwt }),
                                    })
                                )
                            );
                    });
            } else {
                throw new NotInitializedError(NotInitializedErrorType.PaymentNotInitialized);
            }
        }).catch(error => {
            throw new NotInitializedError(NotInitializedErrorType.PaymentNotInitialized);
        });
    }

    finalize(options?: PaymentRequestOptions): Promise<InternalCheckoutSelectors> {
        return Promise.reject(new OrderFinalizationNotRequiredError());
    }

    deinitialize(options?: PaymentRequestOptions): Promise<InternalCheckoutSelectors> {
        return Promise.resolve(this._store.getState());
    }

    private _resolveAuthorizationPromise(jwt: string): void {
        this._cardinalEvent$.next({
            type: CardinalPaymentStep.AUTHORIZATION,
            jwt,
            status: true,
        });
    }

    private _rejectSetupEvent(): void {
        this._cardinalEvent$.next({
            type: CardinalPaymentStep.SETUP,
            status: false,
        });
    }

    private _rejectAuthorizationPromise(data: CardinalValidatedData): void {
        this._cardinalEvent$.next({
            type: CardinalPaymentStep.AUTHORIZATION,
            data,
            status: true,
        });
    }

    private _addExtraData(payment: CreditCardInstrument, extraData: any): CreditCardInstrument {
        payment.extraData = extraData;

        return payment;
    }
}