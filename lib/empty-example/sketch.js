// ------ USGS Earthquake “bubble” visualiser ------

// holds the full GeoJSON returned by the API
let earthquakes;
let eqFeatureIndex = 0;

function setup() {
  createCanvas(100, 100);      // give p5 a canvas

  // Build a Request so we can still attach headers
  let url = 'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson';
  const req = new Request(url, {
    method: 'GET',
    headers: { authorization: 'Bearer secretKey' } // demo header
  });

  // httpDo(path, method, datatype, success, error)
  httpDo(
    req,          // path (Request object)
    'GET',        // method – MUST be a string
    'json',       // tell httpDo to parse JSON for us
    res => {      // success callback
      earthquakes = res;
    },
    err => {      // error callback (optional but handy)
      console.error(err);
    }
  );
}

function draw() {
  // wait until the data is loaded
  if (!earthquakes || !earthquakes.features[eqFeatureIndex]) {
    return;
  }

  clear();

  let feature = earthquakes.features[eqFeatureIndex];
  let mag = feature.properties.mag;
  // const { mag } = earthquakes.features[eqFeatureIndex].properties;
  const rad = (mag / 11) * ((width + height) / 2);

  fill(255, 0, 0, 100);
  ellipse(
    width  / 2 + random(-2, 2),
    height / 2 + random(-2, 2),
    rad,
    rad
  );

  eqFeatureIndex =
    eqFeatureIndex >= earthquakes.features.length - 1
      ? 0
      : eqFeatureIndex + 1;
}
