export const NETWORK_DISABLED_MESSAGE = 'Network access is disabled by this application.';

type AnyFunction = (...args: never[]) => unknown;
type AnyConstructor = new (...args: never[]) => unknown;

type RuntimeNavigator = {
    sendBeacon?: AnyFunction;
};

export type NetworkRuntime = {
    fetch?: AnyFunction;
    XMLHttpRequest?: AnyConstructor;
    WebSocket?: AnyConstructor;
    EventSource?: AnyConstructor;
    RTCPeerConnection?: AnyConstructor;
    navigator?: RuntimeNavigator;
};

type Restore = () => void;

function replaceFunction(object: object, property: string, replacement: AnyFunction): Restore | null {
    const descriptor = Object.getOwnPropertyDescriptor(object, property);
    const inheritedValue = property in object ? Reflect.get(object, property) : undefined;

    try {
        Object.defineProperty(object, property, {
            configurable: true,
            value: replacement,
            writable: true,
        });
    } catch {
        return null;
    }

    return () => {
        if (descriptor) {
            Object.defineProperty(object, property, descriptor);
            return;
        }

        Reflect.deleteProperty(object, property);
        if (inheritedValue !== undefined && !(property in object)) {
            Reflect.set(object, property, inheritedValue);
        }
    };
}

function blockedNetworkConstructor(): never {
    throw new Error(NETWORK_DISABLED_MESSAGE);
}

function blockedBeacon(): false {
    return false;
}

function blockedFetch(): Promise<never> {
    return Promise.reject(new Error(NETWORK_DISABLED_MESSAGE));
}

export function installNoNetworkRuntimeGuard(
    runtime: NetworkRuntime = globalThis as unknown as NetworkRuntime,
): Restore {
    const restoreFunctions: Restore[] = [];

    try {
        for (const [name, replacement] of [
            ['fetch', blockedFetch],
            ['XMLHttpRequest', blockedNetworkConstructor],
            ['WebSocket', blockedNetworkConstructor],
            ['EventSource', blockedNetworkConstructor],
            ['RTCPeerConnection', blockedNetworkConstructor],
        ] as const) {
            if (name in runtime) {
                const restore = replaceFunction(runtime, name, replacement);
                if (!restore) {
                    throw new Error(`Unable to disable network primitive: ${name}`);
                }
                restoreFunctions.push(restore);
            }
        }

        if (runtime.navigator && 'sendBeacon' in runtime.navigator) {
            const restore = replaceFunction(runtime.navigator, 'sendBeacon', blockedBeacon);
            if (!restore) {
                throw new Error('Unable to disable network primitive: navigator.sendBeacon');
            }
            restoreFunctions.push(restore);
        }
    } catch (error) {
        for (const restore of [...restoreFunctions].reverse()) {
            restore();
        }
        throw error;
    }

    return () => {
        for (const restore of [...restoreFunctions].reverse()) {
            restore();
        }
    };
}
