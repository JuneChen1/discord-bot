const AWS = require('aws-sdk')
require('dotenv').config()

AWS.config.update({
  accessKeyId: process.env.ACCESS_KEY_ID,
  secretAccessKey: process.env.SECRET_ACCESS_KEY,
  region: process.env.REGION
})

const dynamodb = new AWS.DynamoDB()

const params = {
  TableName: process.env.TABLE,
  KeySchema: [
    { AttributeName: 'UserId', KeyType: 'HASH' }
  ],
  AttributeDefinitions: [
    { AttributeName: 'UserId', AttributeType: 'S' }
  ],
  ProvisionedThroughput: {
    ReadCapacityUnits: 10,
    WriteCapacityUnits: 10
  }
}

dynamodb.createTable(params, function (err, data) {
  if (err) {
    console.error('Unable to create table. Error JSON:', JSON.stringify(err, null, 2))
  } else {
    console.info('Created table. Table description JSON:', JSON.stringify(data, null, 2))
  }
})
