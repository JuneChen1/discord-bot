const AWS = require('aws-sdk')
require('dotenv').config()

function updateItems (userId, wager) {
  AWS.config.update({
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
    region: process.env.REGION
  })

  const docClient = new AWS.DynamoDB.DocumentClient()

  const table = process.env.TABLE

  const params = {
    TableName: table,
    Key: {
      'UserId': userId
    },
    UpdateExpression: 'set Wager = :w',
    ExpressionAttributeValues: {
      ':w': wager
    },
    ReturnValues: 'UPDATED_NEW'
  }

  console.info('Updating the item...')
  return docClient.update(params, function (err, data) {
    if (err) {
      return err
    } else {
      console.info('UpdateItem succeeded')
      return JSON.stringify(data, null, 2)
    }
  }).promise()
}

module.exports = updateItems
