const admin = require("firebase-admin");
const { last, get, size, map } = require("lodash/fp");
var nodemailer = require("nodemailer");

const puppeteer = require("puppeteer");
const $ = require("cheerio");

const serviceAccount = require("./admin.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://reality-scraper.firebaseio.com",
  authDomain: "reality-scraper.firebaseapp.com",
});

const transporter = nodemailer.createTransport({
  service: "Gmail",
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: "realityfrontend@gmail.com",
    pass: "lmU3FT^)yZqo5.&0h*CN",
  },
});

const db = admin.database();
const propertiesRef = db.ref("/properties");

Promise.resolve().then(() => {
  propertiesRef
    .once("value", (snap) => {
      const values = snap.val();

      return getRealities(values);
    })
    .then(() => console.log("done"));
});

const getPropertyDetails = (element) => {
  const title = $("h2", element).text().trim();
  const link = $("a", element).attr("href") || "no-id";
  const imageUrl = $("a > span:nth-child(1) > img", element).attr("src");

  const subtitle = $("span > span.locality.ng-binding", element).text().trim();

  const price = $("span.price.ng-scope", element).text().trim();

  const propertyId = link.substring(link.lastIndexOf("/") + 1);

  return {
    title,
    link,
    imageUrl,
    subtitle,
    price,
    propertyId,
  };
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// const URL =
//   "https://www.sreality.cz/hledani/prodej/byty/praha?vlastnictvi=osobni&plocha-od=30&plocha-do=10000000000&cena-od=0&cena-do=5000000&bez-aukce=1";

const URL =
  "https://www.sreality.cz/hledani/prodej/byty/praha?&vlastnictvi=osobni&plocha-do=10000000000&cena-od=0&cena-do=5000000";

const getRealities = async (propertiesById) => {
  try {
    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      // headless: false,
    });
    const page = await browser.newPage();

    let results = {};
    let alreadyInDb = [];
    let updatedPriceProperties = [];

    for (const pageNumber of [...Array(10).keys()]) {
      await page.goto(URL + "&strana=" + pageNumber);
      await wait(1000);
      const html = await page.$eval("html", (e) => e.outerHTML);

      $(".dir-property-list > div", html).each((index, element) => {
        const {
          title,
          link,
          imageUrl,
          subtitle,
          price,
          propertyId,
        } = getPropertyDetails(element);

        const currentProperty = get(propertyId, propertiesById);

        const hasDifferentPrice =
          currentProperty &&
          last(get("price", currentProperty)).ammount !== price;

        if (currentProperty) {
          if (hasDifferentPrice) {
            const propertyWithUpdatedPrice = {
              ...currentProperty,
              updatedAt: new Date().toISOString(),
              price: [
                ...currentProperty.price,
                { ammount: price, createdAt: new Date().toISOString() },
              ],
            };

            updatedPriceProperties.push(link);

            db.ref(`/properties/${propertyId}`).update(
              propertyWithUpdatedPrice,
              (err) => {
                if (err) {
                  console.log({ msg: "Something went wrong", error: err });
                } else {
                  console.log({ msg: "user created sucessfully" });
                }
              }
            );
          }

          alreadyInDb.push(link);
          return;
        }

        if (!currentProperty && title) {
          results = {
            ...results,
            [propertyId]: {
              title,
              subtitle,
              price: [
                {
                  ammount: price,
                  createdAt: new Date().toISOString(),
                },
              ],
              link,
              propertyId,
              imageUrl,
              updatedAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
            },
          };
        } else {
          console.log(
            "---- Some Error --- ",
            JSON.stringify(getPropertyDetails(element), null, 4)
          );
        }
      });
    }

    await browser.close();

    if (size(alreadyInDb) > 1) {
      console.log("These links are already in DB: ");
      alreadyInDb.map((item) => console.log(item));
      console.log("   ");
      console.log("   ");
    }

    if (size(results) > 0) {
      var mailOptions = {
        from: "realityfrontend@gmail.com",
        to: "realityfrontend@gmail.com",
        subject: `${size(results)} nemovovitosti bylo pridano`,
        text: `${map(
          (item) => `https://sreality.cz${item.link}` + "\n",
          results
        )}`,
      };

      transporter.sendMail(mailOptions, function (error, info) {
        if (error) {
          console.log(error);
        } else {
          console.log("Email sent: " + info.response);
        }
      });

      propertiesRef.update(results, (err) => {
        if (err) {
          console.log({ msg: "Something went wrong", error: err });
        } else {
          console.log({ msg: "user created sucessfully" });
        }
      });
    }

    console.log(size(results), ": New properties were listed");
    console.log(size(updatedPriceProperties), ": properties was updated price");

    return await results;
  } catch (error) {
    console.log("----------------------");
    console.log("ERRROR:", error);
    console.log("----------------------");
  }
};
