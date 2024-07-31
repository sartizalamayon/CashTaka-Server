const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require('jsonwebtoken')
require("dotenv").config();
const { MongoClient, ServerApiVersion } = require("mongodb");
const app = express();
const port = process.env.PORT || 3001;

app.use(
  cors({
    origin: ["http://localhost:5174", "http://localhost:5173"],
    credentials: true,
  })
);
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.b6ckjyi.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});


const verifyToken = (req, res, next) => {
  if (!req.headers.authorization) {
      return res.status(401).send('Access Denied');
  }
  const token = req.headers.authorization.split(' ')[1];
  if (!token) {
      return res.status(401).send('Access Denied');
  }
  
  jwt.verify(token, process.env.JWT_Secret, (err, decoded) => {
      if (err) {
          return res.status(401).send('Access Denied');
      }

  req.decoded = decoded;
  next();
  });
};

async function run() {
  try {
    await client.connect();

    // Models
    const database = client.db("CashTaka");
    const UsersCollection = database.collection("users"); 
    const Transaction = database.collection("transaction");
    const CashInRequests = database.collection("cashInRequests")
    const CashOutRequests = database.collection("cashOutRequests")

    app.post('/users', async (req, res)=>{
      const user = req.body
      const salt = await bcrypt.genSalt(10);
      const hashedPin = await bcrypt.hash(user.pin, salt);
      user.pin = hashedPin;
      const exists = await UsersCollection.findOne({'$or':[{email:user.email},{number: user.number}]})
      if(!exists){
        const response = await UsersCollection.insertOne(user) 
      if(response.acknowledged){
        res.send({success: true, message: "User created successfully"})
      } 
      else{
        res.send({success: false, message: "Database Error: Failed to create user"})
      }
      }
      else{
        res.send({success: false, message: "Email / Phone number already exists"})
      }
    })

    app.post('/login', async (req, res) => {
      const data = req.body
      existingUser = await UsersCollection.findOne({'$or':[{email:data.user},{number: data.user}]})
      if (!existingUser) {
        return res.status(404).json({ success: false, message: 'Invalid email or number' });
      }
      else{
        const validPin = await bcrypt.compare(data.pin, existingUser.pin);
        if(!validPin){
          return res.status(404).json({ success: false, message: 'Invalid pin' });
        }
        else{
          const token = jwt.sign(data, process.env.JWT_Secret, { expiresIn: '1h' });
          return res.status(200).send({token, user:existingUser});
        }
      }
    })

    app.patch('/user/lastlogin/:number', async(req, res)=>{
      const number = req.params.number
      const response = await UsersCollection.updateOne({number:number}, {$set:{lastLogin: new Date().toISOString()}})
      if(response.acknowledged){
        res.send({success: true, message: "Last login updated successfully"})
      }
      else{
        res.send({success: false, message: "Database Error: Failed to update last login"})
      }
    })

    app.get('/user/balance/:number', async(req, res) =>{
      const number = req.params.number
      const user = await UsersCollection.findOne({number:number})
      if(user){
        res.send({balance: user.balance})
      }
    })

    app.get('/user/role/:info', async(req, res)=>{
      console.log('hit')
      const info = req.params.info
      const user = await UsersCollection.findOne({'$or':[{email:info} , {number:info}]})
      if(user){
        res.status(200).send({role:user.role})
      }else{
        res.status(404).send("Not Found")
      }
    })

    app.get('/user', verifyToken, async (req, res) => {
      const info = req.decoded.user;
      const user = await UsersCollection.findOne({'$or':[{email:info} , {number:info}]})
      if (user) {
        res.send({ success: true, user });
      } else {
        res.send({ success: false, message: 'User not found' });
      }
    });

    app.post('/send-money', verifyToken, async (req, res) => {
      const transaction = req.body
      transaction.type = "Send Money"
      const sender = await UsersCollection.findOne({'$or':[{email:transaction.sender} , {number:transaction.sender}]})
      const receiver = await UsersCollection.findOne({'$or':[{email:transaction.receiver} , {number:transaction.receiver}]})
      
      if(sender && receiver){
        const validPin = await bcrypt.compare(transaction.pin, sender.pin);
        if(!validPin){
          return res.status(404).json({ success: false, message: 'Invalid pin' });
        }
        else{
            const cut = transaction.amount < 100? transaction.amount : transaction.amount+5
            const response = await UsersCollection.updateOne({number:sender.number}, {$inc:{balance: -cut}})
            if(response.acknowledged){
              const response = await UsersCollection.updateOne({number:receiver.number}, {$inc:{balance: transaction.amount}})
              if(response.acknowledged){
                const response = await Transaction.insertOne(transaction)
                if(response.acknowledged){
                  res.status(200).send({success: true, message: "Transaction successful"})
                }
                else{
                  const rollback = await UsersCollection.updateOne({number:sender.number}, {
                    $inc:{balance: cut}
                  })
                  res.status(404).send({success: false, message: "Database Error: Failed to update receiver balance"})
                }
              }
              else{
                const rollback = await UsersCollection.updateOne({number:sender.number}, {
                  $inc:{balance: cut}
                })
                res.status(404).send({success: false, message: "Database Error: Failed to update receiver balance"})
              }
            }else{
              res.status(404).send({success: false, message: "Database Error: Failed to update sender balance"})
            }
        }
      }else{
        res.status(404).send({success: false, message: "Sender or Receiver"})
      }
    })


  } catch (error) {
    console.error("Failed to connect to MongoDB:", error);
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello CashTaka!");
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
