#ifndef CUSTOM_TYPE_HEADER_H
#define CUSTOM_TYPE_HEADER_H

#include <stdio.h>

typedef struct s_user
{
int id;
char *name;
}t_user;

t_user *find_user_by_id(t_user *users,FILE *stream,int id);

#endif
