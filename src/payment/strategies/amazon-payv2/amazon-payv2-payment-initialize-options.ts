export default interface AmazonPayv2PaymentInitializeOptions {
    container: string;
    signInCustomer(): Promise<void>;
}
