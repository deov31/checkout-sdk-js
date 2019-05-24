import { createScriptLoader } from '@bigcommerce/script-loader';

import CybersourceScriptLoader from './cybersource-script-loader';
import { StandardError } from '../../../common/error/errors';
import { CardinalWindow, CyberSourceCardinal } from './cybersource';
import { getCybersource } from '../../payment-methods.mock';
import PaymentMethod from '../../payment-method';
import { getCyberSourceScriptMock } from './cybersource.mock';

describe('CybersourceScriptLoader', () => {
    const cardinalWindow: CardinalWindow = window;
    const scriptLoader = createScriptLoader();
    const scriptMock = getCyberSourceScriptMock();
    let cybersourceScriptLoader: CybersourceScriptLoader;

    beforeEach(() => {
        cybersourceScriptLoader = new CybersourceScriptLoader(scriptLoader, cardinalWindow);
        jest.spyOn(scriptLoader, 'loadScript').mockReturnValue(Promise.resolve(true));
    });

    it('loads widget test script', () => {
        const testMode = true;
        cybersourceScriptLoader.load(testMode);

        expect(scriptLoader.loadScript).toHaveBeenCalledWith(
            'https://songbirdstag.cardinalcommerce.com/edge/v1/songbird.js'
        );
    });

    it('loads widget production script', () => {
        const testMode = false;
        cybersourceScriptLoader.load(testMode);

        expect(scriptLoader.loadScript).toHaveBeenCalledWith(
            'https://songbird.cardinalcommerce.com/edge/v1/songbird.js'
        );
    });

    it('returns script to the window', async () => {
        scriptLoader.loadScript = jest.fn(() => {
            cardinalWindow.Cardinal = scriptMock.Cardinal;

            return Promise.resolve();
        });
        const cybersourceScript = await cybersourceScriptLoader.load();
        expect(cybersourceScript).toBe(cardinalWindow.Cardinal);
    });

    it('throws error to inform that order finalization is not required', async () => {
        scriptLoader.loadScript = jest.fn(() => {
            throw new StandardError();
        });

        try {
            await cybersourceScriptLoader.load();
        } catch (error) {
            expect(error).toBeInstanceOf(StandardError);
        }
    });
    // 24
});
