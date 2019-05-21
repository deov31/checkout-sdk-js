import { includes, some } from 'lodash';
import { Subject } from 'rxjs/index';
import { take } from 'rxjs/operators';

import { CheckoutStore, InternalCheckoutSelectors } from '../../../checkout';
import {
    MissingDataError, MissingDataErrorType, NotInitializedError, NotInitializedErrorType,
    RequestError
} from '../../../common/error/errors';
import StandardError from '../../../common/error/errors/standard-error';
import {OrderActionCreator, OrderPaymentRequestBody} from '../../../order';
import { OrderFinalizationNotRequiredError } from '../../../order/errors';
import OrderRequestBody from '../../../order/order-request-body';
import {CreditCardInstrument, ThreeDSecure} from '../../payment';
import PaymentActionCreator from '../../payment-action-creator';
import PaymentMethod from '../../payment-method';
import { PaymentRequestOptions } from '../../payment-request-options';

import {
    default as SignatureValidationErrors,
    CardinalEventAction, CardinalEventResponse, CardinalEventType, CardinalInitializationType, CardinalPaymentBrand,
    CardinalPaymentStep,
    CardinalTriggerEvents,
    CardinalValidatedAction, CardinalValidatedData, CyberSourceCardinal, SetupCompletedData,
} from './cybersource';
import CyberSourceScriptLoader from './cybersource-script-loader';

export default class CyberSourceThreeDSecurePaymentProcessor {
    private _Cardinal?: CyberSourceCardinal;
    private _paymentMethod?: PaymentMethod;
    private _cardinalEvent$: Subject<CardinalEventResponse>;
    private _isSetupCompleted = false;

    constructor(
        private _store: CheckoutStore,
        private _orderActionCreator: OrderActionCreator,
        private _paymentActionCreator: PaymentActionCreator,
        private _cyberSourceScriptLoader: CyberSourceScriptLoader
    ) {
        this._cardinalEvent$ = new Subject();
    }

    initialize(paymentMethod: PaymentMethod): Promise<InternalCheckoutSelectors> {
        if (this._isSetupCompleted) {
            return Promise.resolve(this._store.getState());
        }

        this._paymentMethod = paymentMethod;

        if (!this._paymentMethod || !this._paymentMethod.clientToken) {
            throw new MissingDataError(MissingDataErrorType.MissingPaymentMethod);
        }

        const clientToken = this._paymentMethod.clientToken;

        return this._cyberSourceScriptLoader.load(this._paymentMethod.config.testMode)
            .then(Cardinal => {
                this._Cardinal = Cardinal;

                this._Cardinal.configure({
                    logging: {
                        level: 'on',
                    },
                });

                this._Cardinal.on(CardinalEventType.SetupCompleted, (setupCompletedData: SetupCompletedData) => {
                    this._resolveSetupEvent();
                });

                this._Cardinal.on(CardinalEventType.Validated, (data: CardinalValidatedData, jwt: string) => {
                    switch (data.ActionCode) {
                        case CardinalValidatedAction.SUCCCESS:
                            this._resolveAuthorizationPromise(jwt);
                            break;
                        case CardinalValidatedAction.NOACTION:
                            if (data.ErrorNumber > 0) {
                                this._rejectAuthorizationPromise(data, CardinalEventAction.ERROR);
                            } else {
                                this._resolveAuthorizationPromise(jwt);
                            }
                            break;
                        case CardinalValidatedAction.FAILURE:
                            data.ErrorDescription = 'User failed authentication or an error was encountered while processing the transaction';
                            this._rejectAuthorizationPromise(data, CardinalEventAction.ERROR);
                            break;
                        case CardinalValidatedAction.ERROR:
                            if (includes(SignatureValidationErrors, data.ErrorNumber)) {
                                this._rejectSetupEvent();
                            } else {
                                this._rejectAuthorizationPromise(data, CardinalEventAction.ERROR);
                            }
                    }
                });

                this._Cardinal.setup(CardinalInitializationType.Init, {
                    jwt: clientToken,
                });

                return new Promise((resolve, reject) => {
                    this._cardinalEvent$
                        .pipe(take(1))
                        .subscribe((event: CardinalEventResponse) => {
                            if (event.type.step === CardinalPaymentStep.SETUP) {
                                if (!event.status) {
                                    reject(new MissingDataError(MissingDataErrorType.MissingPaymentMethod));
                                }

                                this._isSetupCompleted = true;
                                resolve();
                            }
                        });
                });
            }).then(() => this._store.getState());
    }

    execute(payment: OrderPaymentRequestBody, order: OrderRequestBody, paymentData: CreditCardInstrument, options?: PaymentRequestOptions): Promise<InternalCheckoutSelectors> {
        if (!this._Cardinal) {
            return Promise.reject(new NotInitializedError(NotInitializedErrorType.PaymentNotInitialized));
        }

        return this._Cardinal.trigger(CardinalTriggerEvents.BIN_PROCCESS, paymentData.ccNumber).then(result => {
            if (result && result.Status) {
                return this._store.dispatch(this._orderActionCreator.submitOrder(order, options))
                    .then(() =>
                        this._store.dispatch(
                            this._paymentActionCreator.submitPayment({ ...payment, paymentData })
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

                        // If credit card is enrolled in 3DS Cybersource will handle the rest of the flow
                        return new Promise<string>((resolve, reject) => {
                            this._cardinalEvent$
                                .pipe(take(1))
                                .subscribe((event: CardinalEventResponse) => {
                                    if (event.type.step === CardinalPaymentStep.AUTHORIZATION) {
                                        if (event.status) {
                                            resolve(event.jwt);
                                        } else {
                                            const message = event.data ? event.data.ErrorDescription : '';
                                            reject(new StandardError(message));
                                        }
                                    }
                                });
                        }).then(jwt =>
                            this._store.dispatch(
                                this._paymentActionCreator.submitPayment({
                                    ...payment,
                                    paymentData: this._addThreeDSecureData(paymentData, { token: jwt }),
                                })
                            )
                        );
                    });
            } else {
                throw new NotInitializedError(NotInitializedErrorType.PaymentNotInitialized);
            }
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
            type: {
                step: CardinalPaymentStep.AUTHORIZATION,
                action: CardinalEventAction.OK,
            },
            jwt,
            status: true,
        });
    }

    private _resolveSetupEvent(): void {
        this._cardinalEvent$.next({
            type: {
                step: CardinalPaymentStep.SETUP,
                action: CardinalEventAction.OK,
            },
            status: true,
        });
    }

    private _rejectSetupEvent(): void {
        this._cardinalEvent$.next({
            type: {
                step: CardinalPaymentStep.SETUP,
                action: CardinalEventAction.ERROR,
            },
            status: false,
        });
    }

    private _rejectAuthorizationPromise(data: CardinalValidatedData, action: CardinalEventAction): void {
        this._cardinalEvent$.next({
            type: {
                step: CardinalPaymentStep.AUTHORIZATION,
                action,
            },
            data,
            status: false,
        });
    }

    private _addThreeDSecureData(payment: CreditCardInstrument, threeDSecure: ThreeDSecure): CreditCardInstrument {
        payment.threeDSecure = threeDSecure;

        return payment;
    }
}
