import { StackContext, Api, Table } from "sst/constructs";

export function API({ stack }: StackContext) {
  const tableTokens = new Table(stack, "contactly-tokens", {
    fields: {
      id: "string",
      key: "string",
      destination: "string",
      destinationId: "string",
      createdAt: "string",
      accessToken: "string",
      refreshToken: "string",
      expires: "string",
    },
    primaryIndex: { partitionKey: "key", sortKey: "createdAt" },
  });

  stack.setDefaultFunctionProps({
    environment: {
      NODE_ENV: process.env.NODE_ENV || 'development',
      TABLE_TOKENS: tableTokens.tableName
    },
  });

  const api = new Api(stack, "api", {
    routes: {
      "GET /health": "packages/functions/src/lambda.health",
      "POST /forward-contact": "packages/functions/src/lambda.forwardContact",
      "GET /forward-contact/auth": "packages/functions/src/lambda.auth",
    },
  });

  api.attachPermissions([
    'dynamodb:Query',
    'dynamodb:Scan',
    'dynamodb:GetItem',
    'dynamodb:BatchGetItem',
    'dynamodb:PutItem',
    'dynamodb:UpdateItem',
    'dynamodb:DeleteItem',
  ])

  stack.addOutputs({
    ApiEndpoint: api.url,
  });
}
