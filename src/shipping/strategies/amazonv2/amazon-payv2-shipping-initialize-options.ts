import { StandardError } from '../../../common/error/errors';

/**
 * A set of options that are required to initialize the shipping step of
 * checkout in order to support Amazon Pay.
 *
 * When Amazon Pay is initialized, a widget will be inserted into the DOM. The
 * widget has a list of shipping addresses for the customer to choose from.
 */
export default interface AmazonPayv2ShippingInitializeOptions {
    /**
     * The ID of a container which the address widget should insert into.
     */
    container?: string;

    onError?(error: StandardError): void;
}
