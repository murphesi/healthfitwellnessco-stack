import { ApiHandler } from "sst/node/api";
import fetch from 'node-fetch';
import pino from 'pino';
// import sendgridClient from '@sendgrid/client';
import { QueryCommand, DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
// import { v4 as uuid } from 'uuid';
import { DateTime } from 'luxon';

import { AweberClient } from './AWeber'

// sendgridClient.setApiKey('');

type WixFormSubmission = {
  data: {
    formName: string
    submissionTime: DateTime
    contact: {
      name?: {
        first?: string
        last?: string
      },
      phone?: string
      email: string
    }
  }
}

type AweberTokenResponse = {
  refresh_token: string
  token_type?: 'bearer'
  access_token?: string
  expires_in?: number
  expires?: DateTime
  destination?: string
  destinationId?: string | number
}

type StoreTokenOptions = {
  key: string
  token: AweberTokenResponse
  destination: string
  destinationId: string | number
}

type GetTokenOptions = {
  key: string
}

const config = {
  destination: 'AWEBER',
  clientId: 'PAXyuGQbjNNNi5iXvRyvqPfdouUwSr2T',
  clientSecret: 'yJVnhV4Z5DehfKXHhnE594cz5ZGyxa1x',
  redirectUri: 'https://csc15urcvf.execute-api.us-east-1.amazonaws.com/forward-contact/auth',
}

export const storeToken = async (options: StoreTokenOptions): Promise<void> => {
  const db = new DynamoDBClient();

  await db.send(new PutItemCommand({
    TableName: process.env.TABLE_TOKENS,
    Item: {
      id: { S: options.key },
      key: { S: `user-${options.key}` },
      createdAt: { S: DateTime.now().toUTC().toISO() },
      destination: { S: options.destination },
      destinationId: { S: options.destinationId.toString() },
      accessToken: { S: options.token.access_token ?? '' },
      refreshToken: { S: options.token.refresh_token ?? '' },
      expires: { S: DateTime.now().plus({ seconds: (options.token.expires_in ?? 7200) }).toUTC().toISO() },
    }
  }))
}

export const getToken = async (options: GetTokenOptions): Promise<AweberTokenResponse | undefined> => {
  const db = new DynamoDBClient();

  let records = await db.send(new QueryCommand({
    ExpressionAttributeNames: {
      '#key': 'key'
    },
    ExpressionAttributeValues: {
      ':key': { S: `user-${options.key}` }
    },
    KeyConditionExpression: '#key = :key',
    TableName: process.env.TABLE_TOKENS || '',
    ScanIndexForward: false,
    Limit: 1
  }))

  for (const record of records?.Items ?? []) {
    const data = <any>unmarshall(record)

    return {
      access_token: data.accessToken,
      refresh_token: data.refreshToken,
      expires: DateTime.fromISO(data.expires),
      destination: data.destination,
      destinationId: data.destinationId,
    }
  }

  return;
}



export const health = ApiHandler(async () => {
  return {
    statusCode: 200,
    body: ''
  };
});

// Authorize: 'https://auth.aweber.com/oauth2/authorize?response_type=code&client_id=PAXyuGQbjNNNi5iXvRyvqPfdouUwSr2T&redirect_uri=https%3A%2F%2Fcsc15urcvf.execute-api.us-east-1.amazonaws.com%2Fforward-contact%2Fauth&scope=account.read list.read subscriber.read list.write subscriber.write&state=16F17849'

export const auth = ApiHandler(async (event) => {
  const logger = pino();
  const { code, state: userId } = event.queryStringParameters ?? {}

  if (!code || !userId) {
    return {
      statusCode: 400,
      body: "Invalid code or state. Please try again."
    };
  }

  /**
   * Only setup for Katies AWeber Account
   */
  if (userId !== '16F17849') {
    return {
      statusCode: 400,
      body: "Invalid AWeber Account ID"
    };
  }
  const accountId = 2234406; // for user 16F17849


  // Get new token from code
  const response = await fetch(`https://auth.aweber.com/oauth2/token?grant_type=authorization_code&code=${code}&redirect_uri=${config.redirectUri}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`
    }
  })

  const token = await response.json() as AweberTokenResponse

  logger.info(token, 'New Token')

  await storeToken({
    key: userId,
    token,
    destination: config.destination,
    destinationId: accountId,
  })

  return {
    statusCode: 200,
    body: "You have successfully connected your app to AWeber."
  };
});



export const forwardContact = ApiHandler(async (event) => {
  const logger = pino();

  const { id, list } = event.queryStringParameters ?? {}

  if (!id || !list) {
    return {
      statusCode: 400,
      body: "Both 'id' and 'list' are required."
    };
  }

  const { data } = JSON.parse(event.body ?? '{}') as WixFormSubmission;

  logger.info(data.contact)

  const { email } = data?.contact

  if (!email) {
    return {
      statusCode: 400,
      body: "'email' is required in the body."
    };
  }

  logger.info(`Forwarding Wix Submission to AWeber: account.${id} : ${email} : list.${list}`);

  const token = await getToken({
    key: id
  })

  if (!token || !token.destination || !token.destinationId) {
    return {
      statusCode: 401,
      body: "Unauthorized: You must authorize your account to continue."
    };
  }

  const client = new AweberClient({
    accountId: token.destinationId,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    refreshToken: token.refresh_token,
    accessToken: token.access_token,
    accessTokenExpiresAt: token.expires?.toJSDate(),
    storeToken: async (oathToken) => {
      logger.info(`Token refresh: ${token.destinationId}`)

      await storeToken({
        key: id,
        token: (oathToken.data as unknown) as AweberTokenResponse,
        destination: token.destination ?? '',
        destinationId: token.destinationId ?? '',
      })
    },
  })

  try {
    const lists = await client.getAllLists();

    const added = await client.addSubscriber(list, {
      email: email,
      update_existing: 'true'
    })

    return {
      statusCode: 200,
      body: JSON.stringify({
        data,
        lists,
        added,
      }),
      headers: {
        'content-type': 'application/json'
      }
    };
  } catch (e: any) {
    logger.error(e)
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: e.message ?? e,
      }),
      headers: {
        'content-type': 'application/json'
      }
    };
  }

  // try {
  //   const result: any = await sendgridClient.request({
  //     method: 'PUT',
  //     url: '/v3/marketing/contacts',
  //     body: {
  //       list_ids: [emailList],
  //       contacts: [{
  //         email,
  //       }],
  //     },
  //   });

  //   return result[0].body
  // } catch (e) {
  //   logger.error(e.response.body);
  // }
});
