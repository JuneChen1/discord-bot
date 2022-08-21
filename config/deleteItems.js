const AWS = require('aws-sdk')
require('dotenv').config()

function deleteItems (userId) {
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
    ReturnValues: 'ALL_OLD'
  }

  console.info('Attempting a conditional delete...')
  return docClient.delete(params, function (err, data) {
    if (err) {
      return err
    } else {
      console.info('Added item')
      return JSON.stringify(data, null, 2)
    }
  }).promise()
}

module.exports = deleteItems
