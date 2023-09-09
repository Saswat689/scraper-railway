import * as cheerio from "cheerio";
import puppeteerExtra from "puppeteer-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import axios from "axios"
import express from "express";
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer'

const __filename = fileURLToPath(import.meta.url);

const __dirname = path.dirname(__filename);

const app = express();

process.setMaxListeners(Infinity);

async function searchGoogleMaps(query) {
  console.log(`Mining started for ${query}`);
  try {
    const start = Date.now();

    puppeteerExtra.use(stealthPlugin());

    const browser = await puppeteerExtra.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
    });

    // const browser = await puppeteerExtra.launch({
    //   args: chromium.args,
    //   defaultViewport: chromium.defaultViewport,
    //   executablePath: await chromium.executablePath(),
    //   headless: "new",
    //   ignoreHTTPSErrors: true,
    // });

    const page = await browser.newPage();

    try {
      await page.goto(
        `https://www.google.com/maps/search/${query.split(" ").join("+")}`
      );
    } catch (error) {
      console.log("error going to page");
    }

    async function autoScroll(page) {
      await page.evaluate(async () => {
        const wrapper = document.querySelector('div[role="feed"]');

        await new Promise((resolve, reject) => {
          var totalHeight = 0;
          var distance = 1000;
          var scrollDelay = 40000;

          var timer = setInterval(async () => {
            var scrollHeightBefore = wrapper.scrollHeight;
            wrapper.scrollBy(0, distance);
            totalHeight += distance;

            if (totalHeight >= scrollHeightBefore) {
              totalHeight = 0;
              await new Promise((resolve) => setTimeout(resolve, scrollDelay));

              // Calculate scrollHeight after waiting
              var scrollHeightAfter = wrapper.scrollHeight;

              if (scrollHeightAfter > scrollHeightBefore) {
                // More content loaded, keep scrolling
                return;
              } else {
                // No more content loaded, stop scrolling
                clearInterval(timer);
                resolve();
              }
            }
          }, 200);
        });
      });
    }

    await autoScroll(page);

    const html = await page.content();
    const pages = await browser.pages();
    await Promise.all(pages.map((page) => page.close()));

    await browser.close();
    console.log("browser closed");

    // get all a tag parent where a tag href includes /maps/place/
    const $ = cheerio.load(html);
    const aTags = $("a");
    const parents = [];
    aTags.each((i, el) => {
      const href = $(el).attr("href");
      if (!href) {
        return;
      }
      if (href.includes("/maps/place/")) {
        parents.push($(el).parent());
      }
    });

    const buisnesses = [];

    parents.forEach((parent) => {
      const url = parent.find("a").attr("href");
      // get a tag where data-value="Website"
      const website = parent.find('a[data-value="Website"]').attr("href");
      // find a div that includes the class fontHeadlineSmall
      const storeName = parent.find("div.fontHeadlineSmall").text();
      // find span that includes class fontBodyMedium
      const ratingText = parent
        .find("span.fontBodyMedium > span")
        .attr("aria-label");

      // get the first div that includes the class fontBodyMedium
      const bodyDiv = parent.find("div.fontBodyMedium").first();
      const children = bodyDiv.children();
      const lastChild = children.last();
      const firstOfLast = lastChild.children().first();
      const lastOfLast = lastChild.children().last();

      buisnesses.push({
        storeName,
        category: firstOfLast?.text()?.split("·")?.[0]?.trim(),
        address: firstOfLast?.text()?.split("·")?.[1]?.trim(),
        phone: lastOfLast?.text()?.split("·")?.[1]?.trim(),
        bizWebsite: website,
        numberOfReviews: ratingText
          ?.split("stars")?.[1]
          ?.replace("Reviews", "")
          ?.trim()
          ? Number(
              ratingText?.split("stars")?.[1]?.replace("Reviews", "")?.trim()
            )
          : null,
        googleUrl: url,
        placeId: `ChI${url?.split("?")?.[0]?.split("ChI")?.[1]}`,
        ratingText,
        stars: ratingText?.split("stars")?.[0]?.trim()
          ? Number(ratingText?.split("stars")?.[0]?.trim())
          : null,
      });
    });
    const end = Date.now();

    console.log(`time in seconds ${Math.floor((end - start) / 1000)}`);

    return buisnesses;
  } catch (error) {
    console.log("error at googleMaps", error.message);
  }
}

let searching = false;
let requests = [];

async function searchCity(q, c,email,res) {
  searching = true;

  let result = await searchGoogleMaps(`${q} ${c}`);

  let G_APP_PASSWORD='wrunfqsnqqinxeov'

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "saswatsingh629@gmail.com",
      pass: G_APP_PASSWORD,
    },
  });

  if (!result) {
    searchCity(q,c,email,res)
    //fail
    const mail_option = {
      from: "saswatsingh629@gmail.com",
      to: email,
      subject: "Unable to fetch leads",
      html: '<h3>Sorry we were unable to fetch the leads for you. Please try again later</h3><p>Results: </p>'+result,
    };
  
    await transporter.sendMail(mail_option);

    return res.status(500).json([])
  }

  if (requests.length == 0) searching = false;

  res.json(result)

  let html = `<h2>Thank You for using software</h2>`

  result.forEach(biz => {
    html += `<p style="padding: 10px; border: 1px solid black; border-radius: 15px; margin: 20px 0;">${JSON.stringify(biz).split(',').join('<br />')}</p>`
  })

  //success
  const mail_option = {
    from: "saswatsingh629@gmail.com",
    to: email,
    subject: "Here's your lead list for "+q+" in "+c,
    html,
  };

  await transporter.sendMail(mail_option);

  if (requests.length > 0) {
    searching = true
    let req = requests[0]
    searchCity(req.query,req.city,req.email,req.res)
    requests.shift()
  }
}

// eg: /custom/arizona/marketingagency

app.get('/custom/:city',(req,res) => {
  console.log('request length:',requests.length)
  if (searching) {
    requests.push({
      'query': req.query.query,
      'city': req.params.city,
      'email': req.query.email,
      res
    })
    return;
  }
  searchCity(req.query.query, req.params.city,req.query.email,res);
})

app.get('/',(req,res) => {
  res.sendFile(path.join(__dirname,'index.html'))
})


app.listen(process.env.PORT || 3000, () => console.log("Server alive"));
