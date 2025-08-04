//+++++++++++++++++++++++++++++++++++++++++++++++++
//Import
//+++++++++++++++++++++++++++++++++++++++++++++++++
import express from "express";
import { default as mongoose } from "mongoose";
import cors from "cors";
//+++++++++++++++++++++++++++++++++++++++++++++++++
const app = express();
const port = 3000;

app.use(cors());

//+++++++++++++++++++++++++++++++++++++++++++++++++
const connectDB = async () => {
  try {
    await mongoose.connect("mongodb://localhost:27017/youtube_mcp");
    console.log("Database Connection Successful!");
  } catch (err) {
    console.error("Database Connection Failed!", err);
  }
};
//+++++++++++++++++++++++++++++++++++++++++++++++++
connectDB();
//+++++++++++++++++++++++++++++++++++++++++++++++++
const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: false,
    },
    gender: {
      type: String,
      required: false,
    },
    email: {
      type: String,
      required: false,
    },
    phone: {
      type: String,
      required: false,
    },
    location: {
      type: String,
      required: false,
    },
  },
  {
    timestamps: true,
  }
);
//+++++++++++++++++++++++++++++++++++++++++++++++++
let usersCollection = mongoose.model("users", userSchema);
//+++++++++++++++++++++++++++++++++++++++++++++++++
//Get The Weather Details By City
//+++++++++++++++++++++++++++++++++++++++++++++++++
app.get("/getWeatherDetails", async (req, res) => {
  console.log(req.query.city);
  if (req.query.city.toLowerCase() === "kolkata") {
    return res.json({ temp: "37c" });
  } else {
    return res.json({ temp: "50c" });
  }
});
//+++++++++++++++++++++++++++++++++++++++++++++++++
//Get The User Details By City
//+++++++++++++++++++++++++++++++++++++++++++++++++
app.get("/getUserByCity", async (req, res) => {
  console.log(req.query.city);
  const getUserList = await usersCollection.find({
    location: req.query.city.toLowerCase(),
  });
  console.log(getUserList);
  return res.json(getUserList);
});

//++++++++++++++++++++++++
//delete user
app.get("/deleteUser", async (req, res) => {
  if (req.query.token === "1") {
    console.log(req.query.email);
    const getUserList = await usersCollection.deleteOne({
      email: req.query.email.toLowerCase(),
    });
    console.log(getUserList);
    console.log(req.query.token);

    return res.json(getUserList);
  }
  return res.json({ message: "error" });
});
//+++++++++++++++++++++++++++++++++++++++++++++++++
//Start The Server
//+++++++++++++++++++++++++++++++++++++++++++++++++
app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
