import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import bcrypt from "bcrypt";
import passport from "passport";
import { Strategy } from "passport-local";
import session from "express-session";
import env from "dotenv";
import axios from "axios";

const app = express();
const port = 4000;
const saltRounds = 10;
env.config();

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    })
);

app.use(bodyParser.urlencoded({extended: true}));
app.use(express.static("public"));

app.use(passport.initialize());
app.use(passport.session());

const db = new pg.Client({
    user: process.env.PG_USER,
    host: process.env.PG_HOST,
    database: process.env.PG_DATABASE,
    password: process.env.PG_PASSWORD,
    port: process.env.PG_PORT,
});

db.connect();

let usernotes = [];
var weather = null;

app.get("/", (req, res) => {
     passport.authenticate("local", {
        successRedirect: "/app",
        failureRedirect: "/",
    })
    res.render("home.ejs");
});

app.get("/login", (req, res)=>{
    if (req.isAuthenticated()){
        res.redirect("/app")
    } else {
    res.render("login.ejs");
    }
});

app.get("/register", (req, res) => {
    if (req.isAuthenticated()){
        res.redirect("/app")
    } else {
    res.render("register.ejs");
    }
});

app.get("/logout", (req, res)=> {
    req.logout(function (err) {
        if (err){
            return next(err);
        }
        usernotes = [];
        weather = null;
        res.redirect("/");
    });
});

app.get("/app", async (req, res) => {
    if (req.isAuthenticated()){
        const city = req.user.city;
        try {
            var weatherData = await axios.get(`http://api.weatherapi.com/v1/forecast.json?key=${process.env.API_KEY}&q=${city}`);
            if (weatherData.data.current){
                weather = weatherData.data.current;
            }
            console.log(weatherData);
            
        } catch (error) {
            console.error(error);
        }
        console.log(weather);
        const userid = req.user.id;
        usernotes = await db.query("SELECT * FROM notes WHERE creator = $1", [userid]);
        usernotes = usernotes.rows;
        if (usernotes.length > 0 && weather !=null){
            res.render("app.ejs", {
                notes: usernotes,
                weatherData: weather,
            });
        } else if(usernotes.length > 0){
            res.render("app.ejs", {
                notes: usernotes,
                weatherError: "No weather data found for your location.",
            });
        }
        else if (weather != null){
            res.render("app.ejs", {
                weatherData: weather,
            });
        } else {
            res.render("app.ejs", {
                weatherError: "No weather data found for your location.",
            });
        }
            
        
    }
    else{
        res.redirect("/login");
    }
});

app.post("/login", passport.authenticate("local",{
        successRedirect: "/app",
        failureRedirect: "/login",
    })
);
app.post("/register", async (req, res) => {
    const email = req.body.username;
    const password = req.body.password;
    const city = req.body.city;

    try {
        const checkResult = await db.query("SELECT * FROM users WHERE email = $1", [email]);
        if (checkResult.rows.length > 0){
            res.redirect("/login");
        } else {
            bcrypt.hash(password, saltRounds, async (err, hash) =>{
                if (err){
                    console.error("error hashing password", err);
                } else {
                    const result = await db.query(
                        "INSERT INTO users (email, password, city) VALUES ($1, $2, $3) RETURNING *",
                        [email, hash, city]
                    );
                    const user = result.rows[0];
                    req.login(user, (err) => {
                        console.log("success");
                        res.redirect("/app");
                    });
                }
            });
        }
    } catch (error) {
        console.log(error);
    }
});

app.post("/submit", async (req, res)=>{
    console.log(req.user.id);
    if (req.body.title == ""){
        var title = "Untitled"
    }
    else{
        var title = req.body.title;
    }
    const content = req.body.content;
    const userid = req.user.id;
    await db.query("INSERT INTO notes (title, content, creator) VALUES ($1, $2, $3)", [title, content, userid]);
    res.redirect("/app");
});

app.post("/app-edit", (req, res)=>{
    const postid = parseInt(req.body.id);
    const searchedIndex = usernotes.findIndex((note) => note.id === postid);
    console.log(usernotes[searchedIndex]);
    if (weather != null){
        res.render("app.ejs", {
            postToEdit: usernotes[searchedIndex],
            notes: usernotes,
            weatherData: weather,
        });
    } else {
        res.render("app.ejs", {
            postToEdit: usernotes[searchedIndex],
            notes: usernotes,
            weatherError: "No weather data found for your location.",
        });
         }
    
});

app.post("/app-update", async (req, res)=> {
    const postid = parseInt(req.body.id);
    const searchedIndex = usernotes.findIndex((note) => note.id === postid);
    const oldNote = usernotes[searchedIndex];
    const newNote = {
        id: postid,
        title: req.body.title || oldNote.title,
        content: req.body.content || oldNote.content,
        creator: oldNote.creator, 
    };
    usernotes[searchedIndex] = newNote;
    await db.query("UPDATE notes SET (title, content) = ($1, $2) WHERE id = $3", [newNote.title, newNote.content, newNote.id]);
    res.redirect("/app");
});

app.post("/app-delete", async (req, res)=>{
    const postid = parseInt(req.body.id);
    const searchedIndex = usernotes.findIndex((note) => note.id === postid);
    const deletedNote = usernotes[searchedIndex];
    usernotes.splice(searchedIndex, 1);

    await db.query("DELETE FROM notes WHERE id = $1", [postid]);

    res.redirect("/app");

});

passport.use(
    new Strategy(async function verify (username, password, cb){
        try {
            const result = await db.query("SELECT * FROM users WHERE email = $1", 
                [username]
            );
            if (result.rows.length > 0){
                const user = result.rows[0];
                const storedHashedPassword = user.password;
                bcrypt.compare(password, storedHashedPassword, (err, valid)=>{
                    if (err) {
                        console.error("Error comparing passwords:", err);
                        return cb(err);
                    }else {
                        if (valid) {
                            return cb(null, user);
                        } else {
                            return cb(null, false);
                        }
                    }
                });
            } else {
                return cb("User not found");
            }
        } catch (error) {
            console.log(error);
        }
    })
);

passport.serializeUser((user, cb)=> {
    cb(null, user);
});

passport.deserializeUser((user, cb)=> {
    cb(null, user);
});

app.listen(port, () => {
    console.log(`Listening on port ${port}`);
});
