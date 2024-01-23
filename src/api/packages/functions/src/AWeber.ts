import { FetchError, ofetch } from 'ofetch'
import type { FetchOptions } from 'ofetch'
import { resolveURL } from 'ufo'
import ClientOAuth2 from 'client-oauth2'

export interface OAuth2ApiClientOptions extends ClientOAuth2.Options {
    /**
     * The OAuth2 client ID.
     */
    clientId: string

    /**
     * The OAuth2 client secret.
     */
    clientSecret: string

    /**
     * The OAuth2 refresh token.
     */
    refreshToken: string

    /**
     * An optional OAuth2 access token.
     */
    accessToken?: string
    accessTokenExpiresAt?: Date

    data?: Record<string, any>

    /**
     * Return `false` to invalidate the current access token.
     */
    getAccessToken?: (data?: Record<string, any>) => Promise<false | string | undefined> | false | string | undefined
    storeToken?: (token: ClientOAuth2.Token, expiresAt?: Date) => Promise<void> | void
}

export class OAuth2ApiClient {
    private _options: OAuth2ApiClientOptions
    private _accessToken: string | undefined
    private _accessTokenExpiresAt: Date | undefined

    constructor(options: OAuth2ApiClientOptions) {
        if (!options) {
            throw new TypeError('OAuth2ApiClient constructor: options is empty')
        }

        this._options = options

        if (options.accessToken) {
            this._accessToken = options.accessToken
        }

        if (options.accessTokenExpiresAt) {
            this._accessTokenExpiresAt = options.accessTokenExpiresAt
        }
    }

    authorize = async (options?: ClientOAuth2.Options): Promise<string> => {
        // we can reuse the current access token if it is not expired
        if (this._accessToken && this._accessTokenExpiresAt && this._accessTokenExpiresAt > new Date()) {
            return this._accessToken
        }

        // try to get the access token from the store
        if (this._options.getAccessToken) {
            const accessToken = await this._options.getAccessToken(this._options.data)

            // we have an access token, use it
            if (accessToken) {
                return this._accessToken = accessToken
            }

            // unset the current access token
            if (accessToken === false) {
                this._accessToken = undefined
            }
        }

        if (this._accessToken) {
            return this._accessToken
        }

        await this.refreshOAuth2Token(options)

        return this._accessToken!
    }

    refreshOAuth2Token = async (options?: ClientOAuth2.Options): Promise<ClientOAuth2.Token> => {
        // reset the current access token
        this._accessToken = undefined
        this._accessTokenExpiresAt = undefined

        const auth = new ClientOAuth2({
            ...this._options,
            ...options,
        })

        const token = await auth.createToken('', this._options.refreshToken, 'bearer', {}).refresh()

        let expiresAt: Date | undefined

        if (typeof token.data?.expires_in === 'number') {
            expiresAt = new Date(Date.now() + (token.data.expires_in * 1000))
            this._accessTokenExpiresAt = expiresAt
        }

        await this._options.storeToken?.(token, expiresAt)

        this._accessToken = token.accessToken

        return token
    }

    sendRequest = async <T>(request: RequestInfo, options?: FetchOptions<'json'>) => {
        const _sendRequest = async () => {
            const accessToken = this._accessToken

            return await ofetch<T>(request, {
                responseType: 'json',
                ...options,
                headers: {
                    Accept: 'application/json',
                    Authorization: `Bearer ${accessToken}`,
                    ...options?.headers,
                },
            })
        }

        try {
            await this.authorize()
            return await _sendRequest()
        }
        catch (e: unknown) {
            if (e instanceof FetchError) {
                if (e.status === 401) {
                    await this.refreshOAuth2Token()
                    return await _sendRequest()
                }
            }

            throw e
        }
    }
}

export interface AweberAccountOptions {
    accountId?: string
}

export type AweberFetchOptions = FetchOptions<'json'> & AweberAccountOptions

export interface AweberCollection<T> {
    entries: T[]
    next_collection_link: string
    prev_collection_link: string
    resource_type_link: string
    start: number
    total_size: number
}

export interface AweberList {
    campaigns_collection_link: string
    custom_fields_collection_link: string
    draft_broadcasts_link: string
    scheduled_broadcasts_link: string
    sent_broadcasts_link: string
    http_etag: string
    id: number
    landing_pages_collection_link: string
    name: string
    resource_type_link: string
    segments_collection_link: string
    self_link: string
    subscribers_collection_link: string
    total_subscribed_subscribers: number
    total_subscribers: number
    total_subscribers_subscribed_today: number
    total_subscribers_subscribed_yesterday: number
    total_unconfirmed_subscribers: number
    total_unsubscribed_subscribers: number
    unique_list_id: string
    uuid: string
    vapid_public_key: string
    web_form_split_tests_collection_link: string
    web_forms_collection_link: string
}

export type AweberLists = AweberCollection<AweberList>

export interface AweberGetListsOptions extends AweberAccountOptions {
    /**
     * The pagination starting offset.
     *
     * @default 0
     * @minimum 0
     */
    start: number

    /**
     * The pagination total entries to retrieve.
     *
     * @default 100
     * @minimum 1
     * @maximum 100
     */
    size: number
}

export interface AweberFindListsOptions extends AweberGetListsOptions {
    /**
     * Name or unique list ID of the list
     *
     * string [ 1 .. 100 ] characters
     */
    name: string
}

/**
 * Request body to add a subscriber.
 */
export interface AweberAddSubscriberRequest {
    /**
     * The subscriber's email address (required).
     */
    email: string

    /**
     * The customer ad tracking field.
     */
    ad_tracking?: string

    /**
     * The custom fields specified on the subscriber. Note that the custom fields are required
     * to already exist for the list. See Custom Fields for details.
     */
    custom_fields?: Record<string, any> // You can define a specific type for custom_fields if needed

    /**
     * The subscriber's IP address. This field is used to determine the following Geo Location fields:
     * area_code, city, country, dma_code, latitude, longitude, postal_code, and region.
     * IP address can only be specified when Subscribers are initially created.
     * Internal, private, or reserved IP addresses are not acceptable.
     */
    ip_address?: string

    /**
     * The sequence number of the last followup message sent to the subscriber.
     * This field determines the next followup message to be sent to the Subscriber.
     * When set to 0 (default), the Subscriber should receive the 1st (autoresponse) Followup message.
     * Set the value of this field to 1001 if you do not want any Followups to be sent to this Subscriber.
     */
    last_followup_message_number_sent?: number

    /**
     * Miscellaneous notes.
     */
    misc_notes?: string

    /**
     * The subscriber's name.
     */
    name?: string

    /**
     * If this parameter is present and set to true, then custom field names are matched case sensitively.
     * Enabling this option also causes the operation to fail if a custom field is included that is not defined for the list.
     */
    strict_custom_fields?: 'true' | 'false'

    /**
     * If this parameter is present and set to true, then if a subscriber is already present on the list,
     * the subscriber will be updated.
     *
     * Note:
     * - Only the fields defined in the patch endpoint will be updated.
     * - Any tags in the request will be appended to the existing Subscriber.
     */
    update_existing?: 'true' | 'false'

    /**
     * A list of tags added to the subscriber. This field is used to apply a list of tags to a Subscriber.
     * With Campaigns, you can trigger a series of messages based on what Tags have been applied to your subscribers.
     */
    tags?: string[]
}

export interface AweberClientOptions {
    /**
     * The aweber account ID.
     */
    accountId: string | number

    /**
     * The OAuth2 client ID.
     */
    clientId: string

    /**
     * The OAuth2 client secret.
     */
    clientSecret: string

    /**
     * The OAuth2 refresh token.
     */
    refreshToken: string

    /**
     * An optional OAuth2 access token.
     */
    accessToken?: string
    accessTokenExpiresAt?: Date

    /**
     * The OAuth2 scope.
     *
     * @default ['account.read', 'list.read', 'list.write', 'subscriber.read', 'subscriber.write']
     */
    scopes?: string[]
    getAccessToken?: (data?: Record<string, any>) => Promise<false | string | undefined> | false | string | undefined
    storeToken?: (token: ClientOAuth2.Token, expiresAt?: Date) => Promise<void> | void
}

export class AweberClient extends OAuth2ApiClient {
    /**
     * The aweber account ID.
     */
    readonly accountId: string

    constructor(options: AweberClientOptions) {
        if (!options?.accountId) {
            throw new TypeError('AweberClient constructor: accountId is empty')
        }
        if (!options?.clientId) {
            throw new TypeError('AweberClient constructor: clientId is empty')
        }
        if (!options?.clientSecret) {
            throw new TypeError('AweberClient constructor: clientSecret is empty')
        }
        // if (!options?.accessToken) {
        //   throw new TypeError('AweberClient constructor: accessToken is empty')
        // }
        if (!options?.refreshToken) {
            throw new TypeError('AweberClient constructor: refreshToken is empty')
        }

        super({
            clientId: options.clientId,
            clientSecret: options.clientSecret,
            refreshToken: options.refreshToken,
            accessToken: options.accessToken,
            accessTokenExpiresAt: options.accessTokenExpiresAt,
            accessTokenUri: 'https://auth.aweber.com/oauth2/token',
            authorizationUri: 'https://auth.aweber.com/oauth2/authorize',
            redirectUri: 'http://localhost:3000/callback',
            scopes: options.scopes || ['account.read', 'list.read', 'list.write', 'subscriber.read', 'subscriber.write'],
            getAccessToken: options.getAccessToken,
            storeToken: options.storeToken,
        })

        this.accountId = String(options.accountId)
    }

    /**
     * This endpoint is used to get a paginated collection of subscriber lists.
     *
     * @see https://api.aweber.com/#tag/Lists/paths/~1accounts~1{accountId}~1lists/get
     */
    getLists = async (options?: AweberGetListsOptions): Promise<AweberLists> => {
        const ep = ['lists']

        return await this._fetch<AweberLists>(ep, {
            query: {
                'ws.start': options?.start,
                'ws.size': options?.size,
            },
        })
    }

    getAllLists = async (): Promise<AweberList[]> => {
        let start = 0
        const MAX_PAGE_SIZE = 100

        const result: AweberList[] = []

        while (true) {
            const response = await this.getLists({
                size: MAX_PAGE_SIZE,
                start,
            })

            if (!response.entries) {
                break
            }

            result.push(...response.entries)

            start += MAX_PAGE_SIZE

            if (start >= response.total_size) {
                break
            }
        }

        return result
    }

    /**
     * This endpoint is used to search for lists when you do not have a link nor know the list ID.
     *
     * @see https://api.aweber.com/#tag/Lists/paths/~1accounts~1{accountId}~1lists?ws.op=find/get
     */
    findList = async (options: AweberFindListsOptions): Promise<AweberLists> => {
        const ep = ['lists']

        return await this._fetch<AweberLists>(ep, {
            query: {
                'ws.op': 'find',
                'name': options.name,
                'ws.start': options?.start,
                'ws.size': options?.size,
            },
        })
    }

    /**
     * This endpoint is used to add subscribers to the specified account and list.
     * Before adding a subscriber to a list, read Can I use this list? to understand the ramifications.
     * If you have a large list of subscribers, please use our list importer.
     * Attempting to use the endpoint to bulk add subscribers is considered abuse which violates our Terms of Service.
     */
    addSubscriber = async (listId: string | number, subscriber: AweberAddSubscriberRequest): Promise<AweberLists> => {
        const ep = ['lists', String(listId), 'subscribers']

        return await this._fetch<AweberLists>(ep, {
            method: 'POST',
            body: subscriber,
        })
    }

    /**
     * Create a url for the Aweber API.
     *
     * @param request The request path, an url.
     * @param accountId
     */
    _getURL = (request: URL | string | string[], accountId?: string) => {
        const parts = (Array.isArray(request) ? request : [request]).filter(Boolean).map(String)

        if (parts.length === 0) {
            return resolveURL('https://api.aweber.com/1.0/accounts', accountId || this.accountId)
        }

        // take the first element of the request, guaranteed to exists after filtering
        const root = parts.shift()!

        if (root.startsWith('http')) {
            return resolveURL(root, ...parts)
        }

        return resolveURL('https://api.aweber.com/1.0/accounts', accountId || this.accountId, root, ...parts)
    }

    /**
     * Fetch a resource from the Aweber API.
     *
     * Use a fully qualified or append a path after `'https://api.aweber.com/1.0/accounts/' + accountId + ...`
     */
    _fetch = async <T>(request: string | string[], { accountId, ...options }: AweberFetchOptions = {}) => {
        const url = this._getURL(request, accountId)

        return this.sendRequest<T>(url, {
            ...options,
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Wix-Contactly-AWeber/1.0.0',
                ...options?.headers,
            },
        })
    }
}