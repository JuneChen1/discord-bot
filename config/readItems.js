const AWS = require('aws-sdk')
require('dotenv').config()

function readItems (userId) {
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
      'UserId': userId.toString()
    }
  }

  return docClient.get(params, function (err, data) {
    if (err) {
      return err
    } else {
      return JSON.stringify(data, null, 2)
    }
  }).promise()
}

module.exports = readItems
