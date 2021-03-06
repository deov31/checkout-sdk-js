enum PaymentStrategyType {
    AFFIRM = 'affirm',
    AFTERPAY = 'afterpay',
    AMAZON = 'amazon',
    CREDIT_CARD = 'creditcard',
    KLARNA = 'klarna',
    LEGACY = 'legacy',
    OFFLINE = 'offline',
    OFFSITE = 'offsite',
    PAYPAL = 'paypal',
    PAYPAL_EXPRESS = 'paypalexpress',
    PAYPAL_EXPRESS_CREDIT = 'paypalexpresscredit',
    SAGE_PAY = 'sagepay',
    SQUARE = 'squarev2',
    NO_PAYMENT_DATA_REQUIRED = 'nopaymentdatarequired',
    BRAINTREE = 'braintree',
    BRAINTREE_PAYPAL = 'braintreepaypal',
    BRAINTREE_PAYPAL_CREDIT = 'braintreepaypalcredit',
    BRAINTREE_VISA_CHECKOUT = 'braintreevisacheckout',
    BRAINTREE_GOOGLE_PAY = 'googlepaybraintree',
    CHASE_PAY = 'chasepay',
    WE_PAY = 'wepay',
    MASTERPASS = 'masterpass',
    STRIPE_GOOGLE_PAY = 'googlepaystripe',
    ZIP = 'zip',
    CONVERGE = 'converge',
}

export default PaymentStrategyType;
