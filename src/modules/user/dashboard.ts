import { Router, Request, Response } from 'express';
import { Module } from '../../handlers/moduleInit';
import { PrismaClient } from '@prisma/client';
import { isAuthenticated } from '../../handlers/utils/auth/authUtil';
import { getUser } from '../../handlers/utils/user/user';
import logger from '../../handlers/logger';
import axios from 'axios';

const prisma = new PrismaClient();

interface ErrorMessage {
  message?: string;
}

const dashboardModule: Module = {
  info: {
    name: 'Dashboard Module',
    description: 'This file is for dashboard functionality.',
    version: '1.0.0',
    moduleVersion: '1.0.0',
    author: 'AirLinkLab',
    license: 'MIT',
  },

  router: () => {
    const router = Router();

    router.get('/', isAuthenticated(), async (req: Request, res: Response) => {
      const errorMessage: ErrorMessage = {};
      try {
        const userId = req.session?.user?.id;
        const user = await prisma.users.findUnique({ where: { id: userId } });
        if (!user) {
          errorMessage.message = 'User not found.';
          res.render('user/dashboard', { errorMessage, user, req });
          return;
        }

        const servers = await prisma.server.findMany({
          where: { ownerId: user.id },
          include: { node: true, owner: true },
        });
        const settings = await prisma.settings.findUnique({ where: { id: 1 } });

        let page: number = 1;

        if (typeof req.query.page === 'string') {
          page = parseInt(req.query.page, 10);
        }

        if (isNaN(page)) {
          page = 1;
        }

        const perPage = 8;
        const startIndex = (page - 1) * perPage;
        const endIndex = page * perPage;

        const serversWithStats = await Promise.all(
          servers.map(async (server) => {
            try {
              const statusResponse = await axios({
                method: 'GET',
                url: `http://${server.node.address}:${server.node.port}/container/status`,
                auth: {
                  username: 'Airlink',
                  password: server.node.key,
                },
                params: { id: server.UUID },
                timeout: 2000,
              });

              const isRunning = statusResponse.data?.running === true;
              let ramUsage = '0';
              let cpuUsage = '0';
              let ramLimit = '1GB';

              if (isRunning) {
                try {
                  const statsResponse = await axios({
                    method: 'GET',
                    url: `http://${server.node.address}:${server.node.port}/container/stats`,
                    auth: {
                      username: 'Airlink',
                      password: server.node.key,
                    },
                    params: { id: server.UUID },
                    timeout: 2000,
                  });

                  if (statsResponse.data) {
                    ramUsage = statsResponse.data.memory?.percentage || '0';
                    cpuUsage = statsResponse.data.cpu?.percentage || '0';

                    const memLimitBytes = statsResponse.data.memory?.limit || 0;
                    const memLimitGB = (memLimitBytes / (1024 * 1024 * 1024)).toFixed(1);
                    ramLimit = `${memLimitGB}GB`;
                  }
                } catch (statsError) {
                  logger.error(`Error fetching stats for server ${server.UUID}:`, statsError);
                }
              }

              return {
                ...server,
                status: isRunning ? 'running' : 'stopped',
                ramUsage,
                cpuUsage,
                ramLimit
              };
            } catch (error) {
              logger.error(`Error fetching status for server ${server.UUID}:`, error);
              return {
                ...server,
                status: 'stopped',
                ramUsage: '0',
                cpuUsage: '0',
                ramLimit: '1GB'
              };
            }
          })
        );

        const paginatedServers = serversWithStats.slice(startIndex, endIndex);

        res.render('user/dashboard', {
          errorMessage,
          user,
          req,
          settings,
          servers: paginatedServers,
          currentPage: page,
          totalPages: Math.ceil(servers.length / perPage)
        });
      } catch (error) {
        logger.error('Error fetching user:', error);
        errorMessage.message = 'Error fetching user data.';
        const settings = await prisma.settings.findUnique({ where: { id: 1 } });
        res.render('user/dashboard', {
          errorMessage,
          user: getUser(req),
          req,
          settings,
        });
      }
    });

    return router;
  },
};

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit();
});

export default dashboardModule;
