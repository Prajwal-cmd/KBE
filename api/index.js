import express, { urlencoded } from "express";
import dotenv from "dotenv";
import connectDB from "../utils/connectDb.js";
import { errorMiddleware } from "../middlewares/error.js";
import cookieParser from "cookie-parser";
import { v4 as uuid } from "uuid";
import cors from "cors"
import {v2 as cloudinary} from "cloudinary"

import userRouter from "../routes/user.js";
import chatRouter from "../routes/chat.js";

import { Server } from "socket.io";
import { createServer } from "http";
import { ONLINE_USERS,CHAT_JOINED, CHAT_LEAVED, NEW_MESSAGE, NEW_MESSAGE_ALERT, START_TYPING, STOP_TYPING } from "../constants/events.js";
import { getSockets } from "../lib/helper.js";
import { Message } from "../models/message.js";
import { corsOption } from "../constants/config.js";
import { socketAuthenticator } from "../middlewares/auth.js";

dotenv.config({
  path: "./.env",
});

connectDB(process.env.MONGODB_URI);

//cloudinary 
cloudinary.config({
  cloud_name:process.env.CLOUDINARY_CLOUD_NAME,
  api_key:process.env.CLOUDINARY_API_KEY,
  api_secret:process.env.CLOUDINARY_API_SECRET
})

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors:corsOption
});

app.set("io",io)  // to access io in getSocket function in other file 

const port = process.env.PORT || 3000;
const userSocketIDs= new Map()  // currently active users 
const onlineUsers = new Set()

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(cors(corsOption))

app.use("/api/v1/user", userRouter);
app.use("/api/v1/chat", chatRouter);

app.get("/", (req, res) => {
  res.json("Hello");
});


//socket middleware
io.use((socket,next)=>{      // will use cookie to authenticate 
  cookieParser()(socket.request,socket.request.res, async (err)=>{
    await socketAuthenticator(err,socket , next)
  })
}) 
//socket
io.on("connection", (socket) => {
    const user = socket.user // logged in 
    userSocketIDs.set(user._id.toString(),socket.id)



  socket.on(NEW_MESSAGE, async ({ chatId, members, message }) => {

    const messageForRealTime = {
      content: message,
      _id: uuid(),
      sender: {
        _id: user._id,
        name: user.name,
      },
      chat: chatId,
      createdAt: new Date().toISOString(),
    };

    const messageForDb={
        content:message,
        sender:user._id,
        chat:chatId
    }

    const membersSocket = getSockets(members)  // to all whom to send message 

    io.to(membersSocket).emit(NEW_MESSAGE,{
        chatId,
        message:messageForRealTime
    })

    io.to(membersSocket).emit(NEW_MESSAGE_ALERT,{chatId})// to count message for chatId

   try {
     await Message.create(messageForDb)
   } catch (error) {
    console.log(error)
   }

  });

  socket.on(START_TYPING,({members,chatId})=>{

    const memeberSockets = getSockets(members)

    socket.to(memeberSockets).emit(START_TYPING,{chatId})
  })

  
  socket.on(STOP_TYPING,({members,chatId})=>{

    const memeberSockets = getSockets(members)

    socket.to(memeberSockets).emit(STOP_TYPING,{chatId})
  })

  socket.on(CHAT_JOINED,({userId,members})=>{
    onlineUsers.add(userId.toString())

    const membersSocket = getSockets(members)

    io.to(membersSocket).emit(ONLINE_USERS,Array.from(onlineUsers))
  })

  socket.on(CHAT_LEAVED,({userId,members})=>{
    onlineUsers.delete(userId.toString())
    
    const membersSocket = getSockets(members)

    io.to(membersSocket).emit(ONLINE_USERS,Array.from(onlineUsers))
  })


  socket.on("disconnect", () => {
    userSocketIDs.delete(user._id.toString())
    onlineUsers.delete(user._id.toString())
    socket.broadcast.emit(ONLINE_USERS,Array.from(onlineUsers))
  });
});

app.use(errorMiddleware);

server.listen(port, () => {
  console.log("connect at port");
});



export {userSocketIDs}