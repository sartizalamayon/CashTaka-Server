const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require('jsonwebtoken')
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
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
    const TopUpRequests = database.collection("topUpRequests")

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
                if(transaction.amount >= 100){
                  await UsersCollection.updateOne({number:admin.number},{$inc:{balance: 5}})
                }
                delete transaction.pin;
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

    app.post('/cash-out', verifyToken, async (req, res) => {
      const transaction = req.body;
      transaction.type = "Cash Out";
      const sender = await UsersCollection.findOne({'$or':[{email:transaction.sender}, {number:transaction.sender}]});
      const agent = await UsersCollection.findOne({'$or':[{email:transaction.receiver}, {number:transaction.receiver}]});
      
      if (sender && agent) {
        const validPin = await bcrypt.compare(transaction.pin, sender.pin);
        if (!validPin) {
          return res.status(404).json({ success: false, message: 'Invalid pin' });
        } else {
          const response = await UsersCollection.updateOne({number:sender.number}, {$inc:{balance:-(transaction.amount+transaction.fee)}});
          if (response.acknowledged) {
            const response = await UsersCollection.updateOne({number:agent.number}, {$inc:{balance:(transaction.amount+transaction.fee)}});
            if (response.acknowledged) {
              delete transaction.pin;
              const response = await Transaction.insertOne(transaction);
              if (response.acknowledged) {
                res.status(200).send({ success: true, message: 'Transaction successful' });
              } else {
                const rollback = await UsersCollection.updateOne({number:sender.number}, {
                  $inc: { balance: (transaction.amount+transaction.fee) }});
                const rollback2 = await UsersCollection.updateOne({number:agent.number}, {
                  $inc: { balance: -(transaction.amount+transaction.fee) }})
                res.status(404).send({ success: false, message: 'Database Error: Failed to update receiver balance' });
              }
            } else {
              const rollback = await UsersCollection.updateOne({number:sender.number}, {
                $inc: { balance: transaction.amount }
              });
              res.status(404).send({ success: false, message: 'Database Error: Failed to update receiver balance' });
            }
          } else {
            res.status(404).send({ success: false, message: 'Database Error: Failed to update sender balance' });
          }
        }
      } else {
        return res.status(404).json({ success: false, message: 'Sender or agent not found' });
      }
    });

    app.post('/cash-in', verifyToken, async (req, res) => {
      const cashInReq = req.body;
      const sender = await UsersCollection.findOne({'$or':[{email: cashInReq.sender}, {number: cashInReq.sender}]});
      const agent = await UsersCollection.findOne({'$or':[{email: cashInReq.receiver}, {number: cashInReq.receiver}]});
      
      if (sender && agent) {
        const response = await CashInRequests.insertOne(cashInReq);
        if (response.acknowledged) {
          res.status(200).send({ success: true, message: 'Cash In request saved successfully' });
        } else {
          res.status(500).send({ success: false, message: 'Failed to save Cash In request' });
        }
      } else {
        res.status(404).json({ success: false, message: 'Sender or agent not found' });
      }
    });

    app.get('/user/transactions/:number/:total?', async (req, res) => {
      const { number, total } = req.params;
      
      try {
        const limit = total ? parseInt(total, 10) : null;

        const transactions = await Transaction.find({'$or':[{sender: number}, {receiver: number}]})
          .sort({ date: -1 })
          .limit(limit)
          .toArray();
    
        res.status(200).json(transactions);
      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'Error fetching transactions'
        });
      }
    })

    app.get('/cash-in-requests/:number/:email', verifyToken, async (req, res) => {
      const number = req.params.number;
      const email = req.params.email;
      const requests = await CashInRequests.find({'$or':[{receiver: number},{receiver:email}]}).toArray();
      res.send(requests);
    });
  
    app.post('/cash-in-requests/approve', verifyToken, async (req, res) => {
      const { id } = req.body;
      const request = await CashInRequests.findOne({ _id: new ObjectId(id) });
      if (!request) {
          return res.status(404).send({ success: false, message: 'Request not found' });
      }
  
      const sender = await UsersCollection.findOne({ number: request.sender });
  
      if (!sender) {
          return res.status(404).send({ success: false, message: 'Receiver not found' });
      }
  
      const updateReceiver = await UsersCollection.updateOne({'$or':[{number: request.receiver},{email:request.receiver}]}, { $inc: { balance: -request.amount } });
      const updateSender = await UsersCollection.updateOne({ number: request.sender }, { $inc: { balance: request.amount } });
  
      if (updateReceiver.acknowledged && updateSender.acknowledged) {
          await CashInRequests.deleteOne({ _id: new ObjectId(id) });
          await Transaction.insertOne({
              type: 'Cash In',
              sender: request.sender,
              senderName: request.senderName,
              receiver: request.receiver,
              amount: request.amount,
              date: new Date().toISOString(),
              fee: 0
          });
  
          res.status(200).send({ success: true, message: 'Cash In Request approved and completed' });
      } else {
          res.status(500).send({ success: false, message: 'Failed to approve Cash In Request' });
      }
  });

  app.delete(`/cash-in-requests/decline/:requestId`, verifyToken, async (req, res) => {
    const requestId = req.params.requestId
    const request = await CashInRequests.findOne({ _id: new ObjectId(requestId) });

    if (!request) {
        return res.status(404).send({ success: false, message: 'Request not found' });
    }

    await CashInRequests.deleteOne({ _id: new ObjectId(requestId) });

    res.status(201).send({ success: true, message: 'Cash In Request declined and deleted' });
  });


  app.get('/user/alltransactions/:email/:number', async (req, res) => {
    const { email, number } = req.params;
  
    try {
      const transactions = await Transaction.find({
        $or: [
          { sender: email },
          { sender: number },
          { receiver: email },
          { receiver: number },
        ],
      }).sort({ date: -1 }).toArray();
  
      if (transactions.length === 0) {
        return res.json([]);
      }
  
      res.json(transactions);
    } catch (error) {
      res.status(500).json({ message: 'Server error', error });
    }
  });
  

  app.post('/top-up', verifyToken, async (req, res) => {
    const topUpReq = req.body;
    const agent = await UsersCollection.findOne({ number: topUpReq.sender });
    
    if (agent) {
      const validPin = await bcrypt.compare(topUpReq.pin, agent.pin);
      if (!validPin) {
        return res.status(404).json({ success: false, message: 'Invalid pin' });
      } else {
        const response = await TopUpRequests.insertOne(topUpReq);
        if (response.acknowledged) {
          res.status(200).send({ success: true, message: 'Top Up Request successful' });
        } else {
          res.status(404).send({ success: false, message: 'Database Error: Failed to create Top Up request' });
        }
      }
    } else {
      res.status(404).send({ success: false, message: 'Agent not found' });
    }
  });


  app.post("/withdraw", verifyToken, async(req,res)=>{
    const transaction = req.body
    transaction.type = "Withdraw"
    const agent = await UsersCollection.findOne({'$or':[{email:transaction.sender} , {number:transaction.sender}]})
    const admin = await UsersCollection.findOne({'$or':[{email:transaction.receiver} , {number:transaction.receiver}]})

    if(agent && admin){
      const validPin = await bcrypt.compare(transaction.pin, agent.pin);
      if(!validPin){
        return res.status(404).json({ success: false, message: 'Invalid pin' });
      }
      else{
          const response = await UsersCollection.updateOne({number:agent.number}, {$inc:{balance:-(transaction.amount+transaction.fee)}});
          if(response.acknowledged){
            const response = await UsersCollection.updateOne({number:admin.number}, {$inc:{balance:(transaction.amount+transaction.fee)}});
            if(response.acknowledged){
              delete transaction.pin;
              const response = await Transaction.insertOne(transaction);
              if(response.acknowledged){
                res.status(200).send({success: true, message: "Transaction successful"})
              }
              else{
                const rollback = await UsersCollection.updateOne({number:agent.number}, {
                  $inc:{balance: transaction.amount}
                })
                res.status(404).send({success: false, message: "Database Error: Failed to update receiver balance"})
              }
            }
            else{
              const rollback = await UsersCollection.updateOne({number:agent.number}, {
                $inc:{balance: transaction.amount}
              })
              res.status(404).send({success: false, message: "Database Error: Failed to update receiver balance"})
            }
          }else{
            res.status(404).send({success: false, message: "Database Error: Failed to update sender balance"})
          }
      }
    }
  })
  
  app.get('/users/agent',verifyToken, async(req,res)=>{
    const agents = await UsersCollection.find({role:"agent"}).sort({ date: -1 }).toArray()
    res.send(agents)
  })

  app.get('/users/user',verifyToken, async(req, res)=>{
    const users = await UsersCollection.find({role:"user"}).sort({ date: -1 }).toArray()
    res.send(users)
  })

  app.get('/alltransactions',verifyToken, async(req, res)=>{
    const transactions = await Transaction.find().sort({ date: -1 }).toArray()
    res.send(transactions)
  })

  app.patch('/user/toogle-pending/:number', verifyToken, async(req,res)=>{
    const number = req.params.number
    const user = await UsersCollection.findOne({number:number})
    if(user){
      const response = await UsersCollection.updateOne({number:number}, {$set:{isPending:!user.isPending}})
      if(response.acknowledged){
        res.send({success: true, message: "User status updated successfully"})
      }
      else{
        res.send({success: false, message: "Database Error: Failed to update user status"})
      }
    }
    else{
      res.send({success: false, message: "User not found"})
    }
  })

  app.get('/topup/requests', async(req, res)=>{
    const requests = await TopUpRequests.find().sort({ date: -1 }).toArray()
    res.send(requests)
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
