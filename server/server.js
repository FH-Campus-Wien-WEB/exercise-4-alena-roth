const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const session = require("express-session");
const bcrypt = require("bcrypt");
const config = require("./config.js");
const movieModel = require("./movie-model.js");
const userModel = require("./user-model.js");

const app = express();

// Parse urlencoded bodies
app.use(bodyParser.json());

// Session middleware
app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // Set to true if using HTTPS
}));

// Serve static content in directory 'files'
app.use(express.static(path.join(__dirname, "files")));

app.post("/login", function (req, res) {
  const { username, password } = req.body;
  const user = userModel[username];
  if (user && bcrypt.compareSync(password, user.password)) {
    req.session.user = {
      username,
      firstName: user.firstName,
      lastName: user.lastName,
      loginTime: new Date().toISOString(),
    };
    res.send(req.session.user);
  } else {
    res.sendStatus(401);
  }
});

// Task 1.3: Implement the GET `/logout` endpoint and requireLogin
// protection. Implement logout by destroying the session 
// with error handling. Protect all endpoints that need 
// authentication with `requireLogin`.

// middleware
function requireLogin(req, res, next) { // <-- middleware function; name + codes + session expression as given in exercise
  if (req.session.user) { // only for active users (login) -- "destroy" to kill session (cookie); needs to be missing
    next();
  } else {
    res.sendStatus(401);
  }
}

app.get("/logout", function (req, res) {
  req.session.destroy((err) => { // removes session (destroys user state, protects endpoints)
    if (err) {
      console.error("Logout failed:", err);
      res.sendStatus(500); // internal server error
    } else {
      res.sendStatus(200); // ok
    }
  });
}); // tested by trying to reach endpoints in url

// own code for 1.3 ends here


app.get("/session", function (req, res) { // no requireLogin because fail ok
  if (req.session.user) {
    res.send(req.session.user);
  } else {
    res.status(401).json(null);
  }
});

app.get("/movies", requireLogin, function (req, res) { // added requireLogin
  const username = req.session.user.username;
  let movies = Object.values(movieModel.getUserMovies(username));
  const queriedGenre = req.query.genre;
  if (queriedGenre) {
    movies = movies.filter((movie) => movie.Genres.indexOf(queriedGenre) >= 0);
  }
  res.send(movies);
});

// Configure a 'get' endpoint for a specific movie
app.get("/movies/:imdbID", requireLogin, function (req, res) { // added requireLogin
  const username = req.session.user.username;
  const id = req.params.imdbID;
  const movie = movieModel.getUserMovie(username, id);

  if (movie) {
    res.send(movie);
  } else {
    res.sendStatus(404);
  }
});

// Configure a 'put' endpoint for a specific movie to update or insert a movie
app.put("/movies/:imdbID", requireLogin, function (req, res) { // added requireLogin
  const username = req.session.user.username;
  const imdbID = req.params.imdbID;
  const exists = movieModel.getUserMovie(username, imdbID) !== undefined;

  if (!exists) {
    // Task 2.3: Fetch the movie data from OmdbAPI, follow the pattern used further down 
    // in the GET /search endpoint. Implement conversion of the OmdbAPI response to the 
    // movie format used in the frontend. Make sure to handle errors and timeouts properly.

    // complete re-do, closer to search endpoint
    const url = `http://www.omdbapi.com/?apikey=${config.omdbApiKey}&i=${imdbID}` // was fetched directly before; for potential reusability as const

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.omdbTimeoutMs);

    fetch(url, { signal: controller.signal }) // syntax by exercise Angabe
      .then(apiRes => {
        clearTimeout(timeoutId);
        if (!apiRes.ok) {
          return res.sendStatus(apiRes.status);
        }
        return apiRes.text().then(data => {
          let response;
          try {
            response = JSON.parse(data);
          } catch (parseError) {
            console.error('Failed to parse OMDb response:', parseError);
            return res.sendStatus(500);
          }
          if (response.Response === 'True') {

            const results = response;
            const movie = {
              imdbID: results.imdbID,
              Title: results.Title,
              Released: results.Released,
              Runtime: parseInt(results.Runtime),
              Genres: results.Genre.split(", "),
              Directors: results.Director.split(", "),
              Writers: results.Writer.split(", "),
              Actors: results.Actors.split(", "),
              Plot: results.Plot,
              Poster: results.Poster
            };

            movieModel.setUserMovie(username, imdbID, movie);
            res.sendStatus(201);
          } else {
            res.sendStatus(404);
          }
        });
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        if (err.name === "AbortError") {
          console.error("Request timed out");
          return res.sendStatus(504);
        }
        console.error("OMDb API error:", err);
        res.sendStatus(500);
      });
  } else {
    movieModel.setUserMovie(username, imdbID, req.body);
    res.sendStatus(200);
  }
});

app.delete("/movies/:imdbID", requireLogin, function (req, res) { // added requireLogin
  const username = req.session.user.username;
  const id = req.params.imdbID;
  if (movieModel.deleteUserMovie(username, id)) {
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

// Configure a 'get' endpoint for genres of all movies of the current user
app.get("/genres", requireLogin, function (req, res) { // added requireLogin
  const username = req.session.user.username;
  const genres = movieModel.getGenres(username);
  genres.sort();
  res.send(genres);
});

/* Task 2.1. Add the GET /search endpoint: Query omdbapi.com and return
   a list of the results you obtain. Only include the properties 
   mentioned in the README when sending back the results to the client. */
app.get("/search", requireLogin, function (req, res) { // added requireLogin
  const username = req.session.user.username;
  const query = req.query.query;
  if (!query) {
    return res.sendStatus(400);
  }

  const url = `http://www.omdbapi.com/?s=${encodeURIComponent(query)}&apikey=${config.omdbApiKey}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.omdbTimeoutMs);

  fetch(url, { signal: controller.signal })
    .then(apiRes => {
      clearTimeout(timeoutId);
      if (!apiRes.ok) {
        return res.sendStatus(apiRes.status);
      }
      return apiRes.text().then(data => {
        let response;
        try {
          response = JSON.parse(data);
        } catch (parseError) {
          console.error('Failed to parse OMDb response:', parseError);
          return res.sendStatus(500);
        }

        if (response.Response === 'True') {
          const results = response.Search
            .filter(movie => !movieModel.hasUserMovie(username, movie.imdbID))
            .map(movie => ({
              Title: movie.Title,
              imdbID: movie.imdbID,
              Year: isNaN(movie.Year) ? null : parseInt(movie.Year)
            }));
          res.send(results);
        } else {
          res.send([]);
        }
      });
    })
    .catch((err) => {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        console.error('OMDb API request timeout');
        return res.sendStatus(504);
      }
      console.error('OMDb API error:', err);
      res.sendStatus(500);
    });
});

app.listen(config.port);

console.log(`Server now listening on http://localhost:${config.port}/`);
