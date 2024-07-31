const express = require("express");
const { generateSlug } = require("random-word-slugs");
const { ECSClient, RunTaskCommand } = require("@aws-sdk/client-ecs");

const { z } = require("zod");
const { PrismaClient } = require("@prisma/client");
const { error } = require("console");
const { Kafka } = require("kafkajs");
const { v4: uuidv4 } = require("uuid");
const { createClient } = require("@clickhouse/client");
const cors = require("cors");
const app = express();
const PORT = 9000;
const fs = require("fs");
const path = require("path");
const { default: axios } = require("axios");
const { env } = require("process");

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

const kafka = new Kafka({
  clientId: process.env.KAFKA_CLIENTID,
  brokers: ["kafka-1b048c24-sanaptejas98-2e92.h.aivencloud.com:13193"],
  ssl: { ca: [fs.readFileSync(path.join(__dirname, "kafka.pem"), "utf-8")] },
  sasl: {
    username: process.env.KAFKA_USERNAME,
    password: process.env.KAFKA_PASSWORD,
    mechanism: "plain",
  },
});

const client = createClient({
  host: process.env.CLICKHOUSE_HOST,
  database: process.env.CLICKHOUSE_DATABASE,
  username: process.env.CLICKHOUSE_USERNAME,
  password: process.env.CLICKHOUSE_PASSWORD,
});

const consumer = kafka.consumer({ groupId: "api-server-logs-consumer" });

const ecsClient = new ECSClient({
  region: process.env.ECS_REGION,
  credentials: {
    accessKeyId: process.env.ECS_ACCESSKEY,
    secretAccessKey: process.env.ECS_SECRETACCESSKEY,
  },
});

const prisma = new PrismaClient({});

const config = {
  CLUSTER: process.env.ECR_CLUSTER_ARN,
  TASK: process.env.ECR_TASK_ARN,
};

app.use(express.json());
app.use(cors());

app.get("/hello", async (req, res) => {
  return res.json("hello");
});

app.get("/getAccessToken", async (req, res) => {
  const params =
    "?client_id=" +
    CLIENT_ID +
    "&client_secret=" +
    CLIENT_SECRET +
    "&code=" +
    req.query.code;
  const url = "https://github.com/login/oauth/access_token" + params;
  console.log("urrl ", url);
  const response = await axios.post(url, {
    headers: {
      Accept: "application/json",
    },
  });

  return res.json(response.data);
});

//get userData;
app.get("/getUserData", async (req, res) => {
  console.log("tokeen123", req.get("Authorization"));
  try {
    const response = await axios.get("https://api.github.com/user", {
      headers: {
        Authorization: "Bearer " + req.get("Authorization"),
      },
    });
    console.log("data1234", response.data);

    const { id, login } = response.data;
    let user = await prisma.users.findUnique({
      where: { authId: id.toString() },
    });

    if (!user) {
      user = await prisma.users.create({
        data: {
          authId: id.toString(),
          login: login,
          authType: "GITHUB",
        },
      });
      console.log("user created", user);
    }

    return res.json(response.data);
  } catch (error) {
    console.log("error123 ", error);
  }
});

app.get("/getGithubRepos", async (req, res) => {
  try {
    const response = await axios.get(req.query.repos_url, {
      headers: {
        Authorization: req.get("Authorization"),
      },
    });
    console.log("repose99", response);
    return res.json(response.data);
  } catch (error) {
    console.log(error);
  }
});

app.post("/project", async (req, res) => {
  const schema = z.object({
    name: z.string(),
    gitURL: z.string(),
    subDomain: z.string(),
  });
  const safeParseResult = schema.safeParse(req.body);
  if (safeParseResult.error)
    return res.status(400).json({ error: safeParseResult.error });

  const { name, gitURL } = safeParseResult.data;

  const project = await prisma.project.create({
    data: {
      name,
      gitURL,
      subDomain,
    },
  });

  return res.json({ status: "success", data: { project } });
});

app.post("/deploy", async (req, res) => {
  const { projectId, name, gitURL, subDomain } = req.body;
  // const projectSlug = generateSlug();
  let project;
  if (projectId) {
    project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return res.status(404).json({ error: "Project not found" });
  } else {
    project = await prisma.project.findFirst({
      where: {
        name: name,
        gitURL: gitURL,
        subDomain: subDomain,
      },
    });

    if (!project) {
      project = await prisma.project.create({
        data: {
          name: name,
          gitURL: gitURL,
          subDomain: subDomain,
        },
      });
    }
  }

  const deployment = await prisma.deployement.create({
    data: {
      project: { connect: { id: project.id } },
      status: "QUEUED",
      deployementDomain: project.subDomain + "-" + uuidv4().slice(0, 6),
    },
  });
  //spin the container
  const command = new RunTaskCommand({
    cluster: config.CLUSTER,
    taskDefinition: config.TASK,
    launchType: "FARGATE",
    count: 1,
    networkConfiguration: {
      awsvpcConfiguration: {
        assignPublicIp: "ENABLED",
        subnets: [
          "subnet-0b11b578280d066db",
          "subnet-0b0c13d538da8eada",
          "subnet-015a04eea7235fe1d",
          "subnet-09a65059c33deb331",
          "subnet-0632ced5d24974a20",
          "subnet-06d1a83c3e25ac374",
        ],
        securityGroups: ["sg-061547394fbffe2b1"],
      },
    },
    overrides: {
      containerOverrides: [
        {
          name: "builder-image",
          environment: [
            { name: "GIT_REPOSITORY_URL", value: project.gitURL },
            { name: "PROJECT_ID", value: projectId },
            { name: "DEPLOYEMENT_ID", value: deployment.id },
          ],
        },
      ],
    },
  });
  await ecsClient.send(command);
  return res.json({
    status: "queued",
    deploymentId: deployment.id,
    deployementDomain: deployment.deployementDomain,
    subDomain: project.subDomain,
  });
});

app.get("/logs/:id", async (req, res) => {
  const id = req.params.id;
  const logs = await client.query({
    query: `SELECT event_id, deployment_id, log, timestamp from log_events where deployment_id = {deployment_id:String}`,
    query_params: {
      deployment_id: id,
    },
    format: "JSONEachRow",
  });

  const rawLogs = await logs.json();

  return res.json({ logs: rawLogs });
});

async function initKafkaConsumer() {
  try {
    await consumer.connect();
    await consumer.subscribe({ topics: ["container-logs"] });

    await consumer.run({
      // autoCommit: false,
      eachBatch: async function ({
        batch,
        heartbeat,
        commitOffsetsIfNecessary,
        resolveOffset,
      }) {
        const messages = batch.messages;
        console.log(`Received ${messages.length} Messages..`);
        for (const message of messages) {
          const stringMessage = message.value.toString();
          const { PROJECT_ID, DEPLOYEMENT_ID, log } = JSON.parse(stringMessage);

          try {
            const { query_id } = await client.insert({
              table: "log_events",
              values: [
                { event_id: uuidv4(), deployment_id: DEPLOYEMENT_ID, log },
              ],
              format: "JSONEachRow",
            });

            console.log(query_id);
            console.log("message123 ", log);
            if (log == "Done") {
              let depl = await prisma.deployement.update({
                where: {
                  id: DEPLOYEMENT_ID,
                  projectId: PROJECT_ID,
                },
                data: {
                  status: "READY",
                  production: true,
                },
              });

              await prisma.deployement.updateMany({
                where: {
                  projectId: PROJECT_ID,
                  id: {
                    not: DEPLOYEMENT_ID,
                  },
                  production: true,
                },
                data: {
                  production: false,
                },
              });
            }
            resolveOffset(message.offset);
            await commitOffsetsIfNecessary(message.offset);
            await heartbeat();
          } catch (error) {
            console.log(error);
          }
        }
      },
    });
  } catch (error) {
    // console.log(error);
  }
}

initKafkaConsumer();

app.listen(PORT, () => console.log(`API Server Running.. ${PORT}`));
