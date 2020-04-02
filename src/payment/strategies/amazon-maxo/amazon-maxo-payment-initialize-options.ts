export default interface AmazonMaxoPaymentInitializeOptions {
    container: string;
    signInCustomer(): Promise<void>;
}
